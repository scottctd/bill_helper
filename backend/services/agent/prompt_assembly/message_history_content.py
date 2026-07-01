# CALLING SPEC:
# - Purpose: build entity-category prompt context and attachment-backed user content parts.
# - Inputs: SQLAlchemy session, transcript rows or attachment lists, review prefixes, OCR flag.
# - Outputs: entity context markdown and OpenAI-style user content (text or multimodal parts).
# - Side effects: reads taxonomy rows and attachment files from disk.
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from backend.models_agent import AgentTranscriptAttachment, AgentTranscriptMessage
from backend.services.agent import attachment_content
from backend.services.agent.serializers import content_markdown_from_transcript_row
from backend.services.taxonomy import list_term_name_description_pairs


def _compose_user_feedback_text(
    *,
    content_markdown: str,
    review_results_prefix: str | None,
) -> str:
    prefixes = [
        prefix
        for prefix in (review_results_prefix,)
        if isinstance(prefix, str) and prefix.strip()
    ]
    if not prefixes:
        return content_markdown
    feedback = content_markdown.strip() or "(none)"
    return f"{'\n\n'.join(prefixes)}\n\nUser feedback:\n{feedback}"


def build_entity_category_context(db: Session, *, owner_user_id: str | None) -> str | None:
    if owner_user_id is None:
        return None
    records = list_term_name_description_pairs(
        db,
        taxonomy_key="entity_category",
        owner_user_id=owner_user_id,
    )
    if not records:
        return None

    lines: list[str] = []
    for name, description in records:
        if description:
            lines.append(f"- {name}: {description}")
        else:
            lines.append(f"- {name}")
    return "\n".join(lines)


def build_user_content(
    message: AgentTranscriptMessage,
    *,
    model_name: str | None = None,
    review_results_prefix: str | None = None,
    attachments_use_ocr: bool = False,
) -> str | list[dict[str, Any]]:
    content_text = _compose_user_feedback_text(
        content_markdown=content_markdown_from_transcript_row(message),
        review_results_prefix=review_results_prefix,
    )
    attachments = list(message.attachments or [])
    if not attachments:
        return content_text

    parts = attachment_content.assemble_attachment_parts(
        attachments,
        use_ocr=attachments_use_ocr,
    )

    if content_text.strip():
        parts.append({"type": "text", "text": content_text})
    if parts:
        return parts
    return content_text or "User sent attachments."


def build_user_content_from_attachments(
    attachments: list[AgentTranscriptAttachment],
    *,
    content_markdown: str = "",
    review_results_prefix: str | None = None,
    attachments_use_ocr: bool = False,
) -> str | list[dict[str, Any]]:
    content_text = _compose_user_feedback_text(
        content_markdown=content_markdown,
        review_results_prefix=review_results_prefix,
    )
    if not attachments:
        return content_text

    parts = attachment_content.assemble_attachment_parts(
        attachments,
        use_ocr=attachments_use_ocr,
    )
    if content_text.strip():
        parts.append({"type": "text", "text": content_text})
    if parts:
        return parts
    return content_text or "User sent attachments."
