# CALLING SPEC:
# - Purpose: hydrate canonical user messages with attachment parts before provider conversion.
# - Inputs: SQLAlchemy session, run id, canonical transcript messages, attachment OCR flag.
# - Outputs: transcript messages with multimodal user content where attachments exist.
# - Side effects: read-only DB queries for transcript rows and attachments.
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.enums_agent import AgentTranscriptRole
from backend.models_agent import AgentRun, AgentTranscriptAttachment, AgentTranscriptMessage
from backend.services.agent.error_policy import report_recoverable_error
from backend.services.agent.harness.contracts import (
    ImageUrlContentPart,
    TextContentPart,
    TranscriptMessage,
    UserMessage,
)
from backend.services.agent.prompt_assembly.message_history_content import build_user_content

_HYDRATION_SCOPE = "transcript_user_attachment_hydration"


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


def _load_thread_user_rows(db: Session, *, thread_id: str) -> list[AgentTranscriptMessage]:
    return list(
        db.scalars(
            select(AgentTranscriptMessage)
            .join(AgentRun, AgentTranscriptMessage.run_id == AgentRun.id)
            .where(
                AgentRun.thread_id == thread_id,
                AgentTranscriptMessage.role == AgentTranscriptRole.USER,
            )
            .options(
                selectinload(AgentTranscriptMessage.attachments).selectinload(
                    AgentTranscriptAttachment.user_file
                )
            )
            .order_by(
                AgentRun.turn_index.asc(),
                AgentRun.created_at.asc(),
                AgentTranscriptMessage.sequence_index.asc(),
            )
        )
    )


def _load_current_run_user_rows(db: Session, *, run_id: str) -> list[AgentTranscriptMessage]:
    return list(
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


def _align_user_rows_to_transcript(
    transcript: list[TranscriptMessage],
    user_rows: list[AgentTranscriptMessage],
    *,
    transcript_user_skip: int,
    attachments_use_ocr: bool,
) -> list[TranscriptMessage]:
    # Skip the first `transcript_user_skip` UserMessages, then consume
    # `user_rows` from index 0 against the remaining UserMessages.
    transcript_user_index = 0
    user_row_index = 0
    hydrated: list[TranscriptMessage] = []
    for message in transcript:
        if not isinstance(message, UserMessage):
            hydrated.append(message)
            continue
        if transcript_user_index < transcript_user_skip:
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


def _hydrate_current_run_tail(
    db: Session,
    *,
    run_id: str,
    transcript: list[TranscriptMessage],
    attachments_use_ocr: bool,
) -> list[TranscriptMessage]:
    user_rows = _load_current_run_user_rows(db, run_id=run_id)
    if not user_rows:
        return transcript
    transcript_user_count = sum(isinstance(message, UserMessage) for message in transcript)
    current_run_user_start = max(0, transcript_user_count - len(user_rows))
    return _align_user_rows_to_transcript(
        transcript,
        user_rows,
        transcript_user_skip=current_run_user_start,
        attachments_use_ocr=attachments_use_ocr,
    )


def hydrate_transcript_user_attachments(
    db: Session,
    *,
    run_id: str,
    transcript: list[TranscriptMessage],
    attachments_use_ocr: bool = False,
) -> list[TranscriptMessage]:
    run_row = db.get(AgentRun, run_id)
    if run_row is None or run_row.thread_id is None:
        return _hydrate_current_run_tail(
            db,
            run_id=run_id,
            transcript=transcript,
            attachments_use_ocr=attachments_use_ocr,
        )

    user_rows = _load_thread_user_rows(db, thread_id=run_row.thread_id)
    if not user_rows:
        return transcript

    transcript_user_count = sum(isinstance(message, UserMessage) for message in transcript)
    if transcript_user_count != len(user_rows):
        report_recoverable_error(
            scope=_HYDRATION_SCOPE,
            error=ValueError("user row count does not match transcript user messages"),
            context={
                "run_id": run_id,
                "thread_id": run_row.thread_id,
                "transcript_user_count": transcript_user_count,
                "user_row_count": len(user_rows),
            },
        )
        return _hydrate_current_run_tail(
            db,
            run_id=run_id,
            transcript=transcript,
            attachments_use_ocr=attachments_use_ocr,
        )

    return _align_user_rows_to_transcript(
        transcript,
        user_rows,
        transcript_user_skip=0,
        attachments_use_ocr=attachments_use_ocr,
    )
