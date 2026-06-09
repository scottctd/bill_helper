# CALLING SPEC:
# - Purpose: HTTP/background intake for harness-first agent turns.
# - Inputs: thread id, user content, attachments, model selection.
# - Outputs: initialized AgentRun for background harness execution.
# - Side effects: persists canonical transcript and attachment links.
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import shutil
from typing import Callable

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette import status

from backend.database import open_session
from backend.enums_agent import AgentApprovalPolicy, AgentRunStatus, AgentTranscriptRole
from backend.models_agent import AgentRun, AgentThread, AgentTranscriptAttachment, AgentTranscriptMessage
from backend.services.agent.attachment_content import model_supports_vision
from backend.services.agent.attachments import (
    attach_existing_user_files_to_transcript,
    ingest_draft_attachment_upload,
    transcript_attachments_require_vision,
)
from backend.services.agent import runtime as agent_runtime
from backend.services.agent.harness.contracts import HarnessApprovalPolicy, HarnessPrincipal
from backend.services.agent.model_gateway_support.conversion import canonical_transcript_to_provider
from backend.services.agent.production_runtime import initialize_harness_run
from backend.services.agent.thread_context import (
    build_new_turn_owned_messages,
    build_new_turn_transcript,
    next_turn_index,
)
from backend.services.agent.tools_for_model_request import tools_for_agent_model_request
from backend.services.agent.work_sessions import attach_user_file_to_work_session_thread
from backend.services.crud_policy import PolicyViolation
from backend.services.runtime_settings import resolve_runtime_settings
from backend.services.user_files import resolve_user_file_path
from backend.validation.runtime_settings import normalize_text_or_none


@dataclass(slots=True)
class AgentExecutionPolicyError(Exception):
    detail: str
    status_code: int


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_optional_text(value: str | None) -> str:
    return (value or "").strip()


def current_context_tokens_for_thread(
    db: Session,
    *,
    thread: AgentThread,
    model_name: str,
) -> int | None:
    runs_by_newest = sorted(thread.runs, key=lambda run: run.created_at, reverse=True)
    for run in runs_by_newest:
        if run.status == AgentRunStatus.RUNNING:
            transcript = build_new_turn_transcript(db, thread_id=thread.id, user_content="")
            if len(transcript) > 1:
                provider_messages = canonical_transcript_to_provider(transcript[:-1])
                return agent_runtime.calculate_context_tokens(
                    model_name=run.model_name or model_name,
                    llm_messages=provider_messages,
                    tools=tools_for_agent_model_request(thread_title=thread.title),
                )

    if runs_by_newest:
        newest = runs_by_newest[0]
        transcript = build_new_turn_transcript(db, thread_id=thread.id, user_content="")
        if transcript:
            return agent_runtime.calculate_context_tokens(
                model_name=newest.model_name or model_name,
                llm_messages=canonical_transcript_to_provider(transcript),
                tools=tools_for_agent_model_request(thread_title=thread.title),
            )
    return None


def _latest_user_transcript_message(db: Session, *, run_id: str) -> AgentTranscriptMessage | None:
    return db.scalar(
        select(AgentTranscriptMessage)
        .where(
            AgentTranscriptMessage.run_id == run_id,
            AgentTranscriptMessage.role == AgentTranscriptRole.USER,
        )
        .order_by(AgentTranscriptMessage.sequence_index.desc())
        .limit(1)
    )


async def create_user_message_and_start_run(
    *,
    thread_id: str,
    content: str,
    files: list[UploadFile],
    attachment_ids: list[str] | None = None,
    attachments_use_ocr: bool = True,
    db: Session,
    model_name: str | None = None,
    surface: str = "app",
    approval_policy: AgentApprovalPolicy = AgentApprovalPolicy.DEFAULT,
    principal_user_id: str,
    principal_user_name: str | None = None,
) -> AgentRun:
    settings = resolve_runtime_settings(db)
    selected_model_name = normalize_text_or_none(model_name) or settings.agent_model
    if selected_model_name.casefold() not in {
        available_model.casefold() for available_model in settings.available_agent_models
    }:
        raise AgentExecutionPolicyError(
            detail="Selected model is not enabled in runtime settings.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    agent_runtime.ensure_agent_available(db, model_name=selected_model_name)

    thread = db.get(AgentThread, thread_id)
    if thread is None:
        raise AgentExecutionPolicyError(
            detail="Thread not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    clean_content = _normalize_optional_text(content)
    requested_attachment_ids = list(attachment_ids or [])
    if not clean_content and not files and not requested_attachment_ids:
        raise AgentExecutionPolicyError(
            detail="Message must include text or at least one attachment.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    if len(files) + len(requested_attachment_ids) > settings.agent_max_images_per_message:
        raise AgentExecutionPolicyError(
            detail=f"Too many attachments. Max allowed is {settings.agent_max_images_per_message}.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    has_attachments = bool(files or requested_attachment_ids)
    if has_attachments and transcript_attachments_require_vision(
        db,
        files=files,
        attachment_ids=requested_attachment_ids,
        owner_user_id=thread.owner_user_id,
    ) and not model_supports_vision(selected_model_name):
        raise AgentExecutionPolicyError(
            detail="Image and PDF attachments require a vision-capable model.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    turn_index = next_turn_index(db, thread_id=thread.id)
    owned_transcript = build_new_turn_owned_messages(
        db,
        thread_id=thread.id,
        user_content=clean_content,
        surface=surface,
        turn_index=turn_index,
    )
    transcript = build_new_turn_transcript(
        db,
        thread_id=thread.id,
        user_content=clean_content,
        surface=surface,
        turn_index=turn_index,
        owned_messages=owned_transcript,
    )

    harness_policy = HarnessApprovalPolicy(approval_policy.value)
    principal = HarnessPrincipal(user_id=principal_user_id, user_name=principal_user_name)
    run_row = initialize_harness_run(
        db,
        thread=thread,
        transcript=transcript,
        owned_transcript=owned_transcript,
        model_name=selected_model_name,
        surface=surface,
        approval_policy=harness_policy,
        principal=principal,
        turn_index=turn_index,
        metadata={"attachments_use_ocr": attachments_use_ocr},
    )

    user_message_row = _latest_user_transcript_message(db, run_id=run_row.id)
    bundle_dirs_to_cleanup: list[Path] = []
    try:
        if user_message_row is not None and has_attachments:
            for upload in files:
                try:
                    user_file = await ingest_draft_attachment_upload(
                        db,
                        owner_user_id=thread.owner_user_id,
                        upload=upload,
                        settings=settings,
                        use_ocr=attachments_use_ocr,
                    )
                except PolicyViolation as exc:
                    raise AgentExecutionPolicyError(
                        detail=exc.detail,
                        status_code=exc.status_code,
                    ) from exc
                bundle_dirs_to_cleanup.append(resolve_user_file_path(user_file).parent)
                db.add(
                    AgentTranscriptAttachment(
                        transcript_message_id=user_message_row.id,
                        user_file_id=user_file.id,
                    )
                )
                attach_user_file_to_work_session_thread(
                    db,
                    thread=thread,
                    user_file=user_file,
                    note=None,
                )
            try:
                existing_user_files = attach_existing_user_files_to_transcript(
                    db,
                    attachment_ids=requested_attachment_ids,
                    transcript_message_id=user_message_row.id,
                    owner_user_id=thread.owner_user_id,
                )
                for user_file in existing_user_files:
                    attach_user_file_to_work_session_thread(
                        db,
                        thread=thread,
                        user_file=user_file,
                        note=None,
                    )
            except PolicyViolation as exc:
                raise AgentExecutionPolicyError(
                    detail=exc.detail,
                    status_code=exc.status_code,
                ) from exc
    except AgentExecutionPolicyError:
        for bundle_dir in bundle_dirs_to_cleanup:
            shutil.rmtree(bundle_dir, ignore_errors=True)
        db.rollback()
        raise

    thread.updated_at = utc_now()
    db.add(thread)
    db.commit()
    db.refresh(run_row)
    return run_row


def run_agent_in_background(
    run_id: str,
    *,
    session_factory: Callable[[], Session] = open_session,
) -> None:
    from backend.services.agent.stream_hub import start_run_stream_execution

    start_run_stream_execution(run_id, session_factory=session_factory)
