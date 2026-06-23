# CALLING SPEC:
# - Purpose: implement focused service logic for `entry_tag_suggestion_prompt`.
# - Inputs: callers that import `backend/services/entry_tag_suggestion_prompt.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `entry_tag_suggestion_prompt`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

import json
from typing import Any

from backend.schemas_finance import EntryTagSuggestionRequest
from backend.services.entry_similarity import SimilarTaggedEntry


def _draft_payload(draft: EntryTagSuggestionRequest) -> dict[str, Any]:
    return {
        "entry_id": draft.entry_id,
        "kind": draft.kind,
        "occurred_at": draft.occurred_at.isoformat(),
        "currency_code": draft.currency_code,
        "amount_minor": draft.amount_minor,
        "name": draft.name,
        "from_entity_id": draft.from_entity_id,
        "from_entity": draft.from_entity,
        "to_entity_id": draft.to_entity_id,
        "to_entity": draft.to_entity,
        "owner_user_id": draft.owner_user_id,
        "markdown_body": draft.markdown_body,
        "current_tags": draft.current_tags,
    }


def _similar_entry_payload(example: SimilarTaggedEntry) -> dict[str, Any]:
    return {
        "entry_id": example.entry_id,
        "kind": example.kind,
        "occurred_at": example.occurred_at.isoformat(),
        "currency_code": example.currency_code,
        "amount_minor": example.amount_minor,
        "name": example.name,
        "from_entity": example.from_entity,
        "to_entity": example.to_entity,
        "markdown_body": example.markdown_body,
        "tags": example.tags,
    }


def build_entry_tag_suggestion_messages(
    *,
    draft: EntryTagSuggestionRequest,
    tag_catalog: list[dict[str, str | None]],
    category_catalog: list[dict[str, Any]],
    lifecycle_values: list[str],
    similar_entries: list[SimilarTaggedEntry],
) -> list[dict[str, str]]:
    system_prompt = """
You suggest a category, a lifecycle, and auxiliary tags for a ledger entry.

Category describes what the spend/income is for. Pick exactly one leaf category
from the category catalog (by its `name`), preferring the most specific leaf
that fits. A category's `path` shows its parent (e.g. "housing/rent"). If no
category fits, return null for suggested_category.

Lifecycle describes the recurring pattern of this specific transaction:
"fixed" for predictable recurring obligations, "day_to_day" for routine
variable spending, "one_time" for irregular/exceptional purchases. Each
category leaf lists a `default_lifecycle`; use it unless the specific entry
is clearly exceptional (then "one_time") or clearly recurring (then "fixed").
If unclear, return null for suggested_lifecycle.

Tags are auxiliary descriptors only (e.g. e_transfer, travel, needs_review) —
never use a category name as a tag. Choose tags from the existing tag catalog
only. Return no tag rather than inventing a weak match.

Your entire response must be exactly one JSON object and nothing else.
Do not use markdown fences. Do not include any explanation, reasoning, notes,
or extra text. The first character of your response must be `{` and the last
character must be `}`.

Return strictly valid JSON only, with this exact shape:
{"suggested_tags":["tag_name"],"suggested_category":"rent","suggested_lifecycle":"fixed"}
Any of suggested_category / suggested_lifecycle may be null.
""".strip()

    user_payload = {
        "current_entry": _draft_payload(draft),
        "tag_catalog": tag_catalog,
        "category_catalog": category_catalog,
        "lifecycle_values": lifecycle_values,
        "similar_tagged_entries": [_similar_entry_payload(example) for example in similar_entries],
    }
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False, indent=2)},
    ]
