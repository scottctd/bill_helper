# CALLING SPEC:
# - Purpose: hydrate canonical user messages with attachment parts before provider conversion.
# - Inputs: SQLAlchemy session, run id, canonical transcript messages, attachment OCR flag.
# - Outputs: transcript messages with multimodal user content where attachments exist.
# - Side effects: read-only DB queries for transcript rows and attachments.
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.enums_agent import AgentTranscriptRole
from backend.models_agent import AgentTranscriptAttachment, AgentTranscriptMessage
from backend.services.agent.harness.contracts import (
    ImageUrlContentPart,
    TextContentPart,
    TranscriptMessage,
    UserMessage,
)
from backend.services.agent.prompt_assembly.message_history_content import build_user_content


def _content_part_from_dict(part: dict[str, object]):
    if part.get("type") == "image_url":
        return ImageUrlContentPart.model_validate(part)
    return TextContentPart.model_validate(part)


def _user_message_from_row(
    row: AgentTranscriptMessage,
    *,
    attachments_use_ocr: bool,
) -> UserMessage:
    content = build_user_content(row, attachments_use_ocr=attachments_use_ocr)
    if isinstance(content, str):
        return UserMessage(content=content)
    return UserMessage(content=[_content_part_from_dict(part) for part in content])


def hydrate_transcript_user_attachments(
    db: Session,
    *,
    run_id: str,
    transcript: list[TranscriptMessage],
    attachments_use_ocr: bool = False,
) -> list[TranscriptMessage]:
    user_rows = list(
        db.scalars(
            select(AgentTranscriptMessage)
            .where(
                AgentTranscriptMessage.run_id == run_id,
                AgentTranscriptMessage.role == AgentTranscriptRole.USER,
            )
            .options(
                selectinload(AgentTranscriptMessage.attachments).selectinload(
                    AgentTranscriptAttachment.user_file
                )
            )
            .order_by(AgentTranscriptMessage.sequence_index.asc())
        )
    )
    if not user_rows:
        return transcript

    transcript_user_count = sum(isinstance(message, UserMessage) for message in transcript)
    current_run_user_start = max(0, transcript_user_count - len(user_rows))
    transcript_user_index = 0
    user_row_index = 0
    hydrated: list[TranscriptMessage] = []
    for message in transcript:
        if not isinstance(message, UserMessage):
            hydrated.append(message)
            continue
        if transcript_user_index < current_run_user_start:
            transcript_user_index += 1
            hydrated.append(message)
            continue
        transcript_user_index += 1
        if user_row_index < len(user_rows):
            row = user_rows[user_row_index]
            user_row_index += 1
            if row.attachments:
                hydrated.append(
                    _user_message_from_row(
                        row,
                        attachments_use_ocr=attachments_use_ocr,
                    )
                )
                continue
        hydrated.append(message)
    return hydrated
