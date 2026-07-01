# CALLING SPEC:
# - Purpose: suggest tags for a draft entry via a one-shot LLM call.
# - Inputs: principal, DB session, EntryTagSuggestionRequest with entry fields and similar-entry context.
# - Outputs: EntryTagSuggestionResponse with ranked tag names.
# - Side effects: LiteLLM completion through runtime.call_model when agent credentials are configured; raises PolicyViolation on validation or runtime failures.
from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import EntryLifecycle
from backend.models_finance import Tag
from backend.schemas_finance import EntryTagSuggestionRequest, EntryTagSuggestionResponse
from backend.services.agent.model_client_support.client import AgentModelError
from backend.services.crud_policy import PolicyViolation
from backend.services.agent.runtime import call_model, ensure_agent_available
from backend.services.entry_similarity import list_similar_tagged_entries
from backend.services.entry_tag_suggestion_prompt import build_entry_tag_suggestion_messages
from backend.services.runtime_settings import resolve_runtime_settings
from backend.services.taxonomy import entry_category_catalog, normalize_term_name
from backend.validation.finance_names import normalize_tag_name


class _ModelTagSuggestionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggested_tags: list[str] = Field(default_factory=list)
    suggested_category: str | None = None
    suggested_lifecycle: str | None = None


def _normalized_catalog(db: Session) -> tuple[list[dict[str, str | None]], dict[str, str]]:
    tags = list(db.scalars(select(Tag).order_by(Tag.name.asc())))
    catalog_payload = [
        {
            "name": tag.name,
            "description": tag.description,
        }
        for tag in tags
    ]
    tag_name_by_normalized_name = {normalize_tag_name(tag.name): tag.name for tag in tags}
    return catalog_payload, tag_name_by_normalized_name


def _response_format_for_catalog(
    tag_catalog: list[dict[str, str | None]],
    category_names: list[str],
    lifecycle_values: list[str],
) -> dict[str, object]:
    allowed_tag_names = [tag["name"] for tag in tag_catalog if isinstance(tag.get("name"), str)]
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "entry_tag_suggestion",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "suggested_tags": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": allowed_tag_names,
                        },
                    },
                    "suggested_category": {
                        "type": ["string", "null"],
                        "enum": [*category_names, None],
                    },
                    "suggested_lifecycle": {
                        "type": ["string", "null"],
                        "enum": [*lifecycle_values, None],
                    },
                },
                "required": ["suggested_tags", "suggested_category", "suggested_lifecycle"],
            },
        },
    }


def _normalize_weak_context_tags(raw_tags: list[str]) -> list[str]:
    normalized_tags: list[str] = []
    seen: set[str] = set()
    for raw_tag in raw_tags:
        normalized_tag = normalize_tag_name(raw_tag)
        if not normalized_tag or normalized_tag in seen:
            continue
        seen.add(normalized_tag)
        normalized_tags.append(normalized_tag)
    return normalized_tags


def _parse_model_suggestion(
    content: str,
    *,
    tag_name_by_normalized_name: dict[str, str],
    category_name_by_normalized: dict[str, str],
) -> tuple[list[str], str | None, EntryLifecycle | None]:
    try:
        decoded = json.loads(content)
        payload = _ModelTagSuggestionPayload.model_validate(decoded)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise PolicyViolation.bad_request(
            "AI tag suggestion returned malformed JSON.",
        ) from exc

    normalized_suggested_tags: list[str] = []
    seen: set[str] = set()
    for raw_tag in payload.suggested_tags:
        normalized_tag = normalize_tag_name(raw_tag)
        if not normalized_tag or normalized_tag in seen:
            continue
        canonical_tag = tag_name_by_normalized_name.get(normalized_tag)
        if canonical_tag is None:
            raise PolicyViolation.bad_request(
                "AI tag suggestion returned a tag outside the existing catalog.",
            )
        seen.add(normalized_tag)
        normalized_suggested_tags.append(canonical_tag)

    suggested_category: str | None = None
    if payload.suggested_category is not None:
        canonical_category = category_name_by_normalized.get(
            normalize_term_name(payload.suggested_category)
        )
        if canonical_category is None:
            raise PolicyViolation.bad_request(
                "AI tag suggestion returned a category outside the existing catalog.",
            )
        suggested_category = canonical_category

    suggested_lifecycle: EntryLifecycle | None = None
    if payload.suggested_lifecycle is not None:
        try:
            suggested_lifecycle = EntryLifecycle(payload.suggested_lifecycle)
        except ValueError as exc:
            raise PolicyViolation.bad_request(
                "AI tag suggestion returned an invalid lifecycle.",
            ) from exc

    return normalized_suggested_tags, suggested_category, suggested_lifecycle


def suggest_entry_tags(
    db: Session,
    *,
    principal: RequestPrincipal,
    draft: EntryTagSuggestionRequest,
) -> EntryTagSuggestionResponse:
    normalized_current_tags = _normalize_weak_context_tags(draft.current_tags)
    request_draft = draft.model_copy(update={"current_tags": normalized_current_tags})

    try:
        settings = resolve_runtime_settings(db)
    except ValueError as exc:
        raise PolicyViolation.bad_request(str(exc)) from exc

    if not settings.entry_tagging_model:
        raise PolicyViolation.bad_request(
            "AI tag suggestion is disabled until you set Default tagging model in Settings.",
        )

    tag_catalog, tag_name_by_normalized_name = _normalized_catalog(db)
    category_catalog = entry_category_catalog(db, owner_user_id=principal.user_id)
    category_name_by_normalized = {
        normalize_term_name(str(item["name"])): str(item["name"]) for item in category_catalog
    }
    category_names = [str(item["name"]) for item in category_catalog]
    lifecycle_values = [item.value for item in EntryLifecycle]
    response_format = _response_format_for_catalog(tag_catalog, category_names, lifecycle_values)
    similar_entries = list_similar_tagged_entries(
        db,
        principal=principal,
        draft=request_draft,
    )
    messages = build_entry_tag_suggestion_messages(
        draft=request_draft,
        tag_catalog=tag_catalog,
        category_catalog=category_catalog,
        lifecycle_values=lifecycle_values,
        similar_entries=similar_entries,
    )

    try:
        ensure_agent_available(db, model_name=settings.entry_tagging_model)
        response = call_model(
            messages,
            db,
            model_name=settings.entry_tagging_model,
            tools=[],
            response_format=response_format,
        )
    except PolicyViolation:
        raise
    except AgentModelError as exc:
        raise PolicyViolation.service_unavailable(str(exc)) from exc

    suggested_tags, suggested_category, suggested_lifecycle = _parse_model_suggestion(
        response.get("content", ""),
        tag_name_by_normalized_name=tag_name_by_normalized_name,
        category_name_by_normalized=category_name_by_normalized,
    )
    return EntryTagSuggestionResponse(
        suggested_tags=suggested_tags,
        suggested_category=suggested_category,
        suggested_lifecycle=suggested_lifecycle,
    )
