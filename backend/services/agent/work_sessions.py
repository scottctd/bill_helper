# CALLING SPEC:
# - Purpose: manage external-agent sessions and their user-provided source links.
# - Inputs: principal-scoped SQLAlchemy sessions, session ids, raw file/text bytes.
# - Outputs: persisted session/source rows and public schema payloads.
# - Side effects: creates/updates agent thread rows, source links, user files, and synthetic CLI runs.
from __future__ import annotations

from pathlib import Path
import mimetypes

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.enums_agent import (
    AgentChangeStatus,
    AgentMessageRole,
    AgentRunStatus,
    SUPPORTED_AGENT_CHANGE_TYPES,
)
from backend.models_agent import AgentChangeItem, AgentMessage, AgentRun, AgentSessionSource, AgentThread
from backend.models_files import UserFile
from backend.models_shared import utc_now
from backend.schemas_agent_sessions import AgentSessionRead, AgentSessionSourceRead
from backend.services.access_scope import agent_thread_owner_filter, load_agent_thread_for_principal
from backend.services.agent.attachment_mime_types import is_supported_agent_attachment_mime
from backend.services.crud_policy import PolicyViolation
from backend.services.user_files import (
    SOURCE_TYPE_AGENT_SESSION_SOURCE,
    STORAGE_AREA_UPLOAD,
    display_name_for_file,
    store_user_file_bytes,
)
from backend.validation.agent_threads import validate_thread_title

EXTERNAL_AGENT_MODEL_NAME = "external-agent"
EXTERNAL_AGENT_RUN_SURFACE = "cli"


def list_work_sessions(db: Session, *, principal: RequestPrincipal) -> list[AgentSessionRead]:
    threads = list(
        db.scalars(
            select(AgentThread)
            .where(agent_thread_owner_filter(principal))
            .order_by(AgentThread.updated_at.desc())
        )
    )
    return [_session_to_read(db, thread=thread, principal=principal) for thread in threads]


def create_work_session(
    db: Session,
    *,
    principal: RequestPrincipal,
    title: str | None,
    summary: str | None,
) -> AgentThread:
    thread = AgentThread(
        owner_user_id=principal.user_id,
        title=_normalize_title_or_none(title),
        summary=_normalize_text_or_none(summary),
    )
    db.add(thread)
    db.flush()
    return thread


def update_work_session(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
    title: str | None,
    title_is_set: bool,
    summary: str | None,
    summary_is_set: bool,
) -> AgentThread:
    thread = load_agent_thread_for_principal(db, thread_id=session_id, principal=principal)
    if title_is_set:
        thread.title = _normalize_title_or_none(title)
    if summary_is_set:
        thread.summary = _normalize_text_or_none(summary)
    thread.updated_at = utc_now()
    db.add(thread)
    db.flush()
    return thread


def load_work_session(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
) -> AgentThread:
    return load_agent_thread_for_principal(
        db,
        thread_id=session_id,
        principal=principal,
        stmt=select(AgentThread).options(
            selectinload(AgentThread.sources).selectinload(AgentSessionSource.user_file)
        ),
    )


def attach_text_source_to_work_session(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
    text: str,
    filename: str | None,
    display_name: str | None,
    note: str | None,
) -> AgentSessionSource:
    file_bytes = text.encode("utf-8")
    user_file = store_user_file_bytes(
        db,
        owner_user_id=principal.user_id,
        storage_area=STORAGE_AREA_UPLOAD,
        source_type=SOURCE_TYPE_AGENT_SESSION_SOURCE,
        mime_type="text/plain",
        file_bytes=file_bytes,
        original_filename=_safe_source_filename(filename, fallback="source.txt"),
        display_name=_normalize_text_or_none(display_name),
    )
    return attach_user_file_to_work_session(
        db,
        principal=principal,
        session_id=session_id,
        user_file=user_file,
        note=note,
    )


def attach_file_source_to_work_session(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
    file_bytes: bytes,
    original_filename: str | None,
    mime_type: str | None,
    note: str | None,
) -> AgentSessionSource:
    normalized_mime = _normalize_source_mime_type(
        mime_type=mime_type,
        original_filename=original_filename,
    )
    _validate_source_mime_type(normalized_mime)
    user_file = store_user_file_bytes(
        db,
        owner_user_id=principal.user_id,
        storage_area=STORAGE_AREA_UPLOAD,
        source_type=SOURCE_TYPE_AGENT_SESSION_SOURCE,
        mime_type=normalized_mime,
        file_bytes=file_bytes,
        original_filename=original_filename,
    )
    return attach_user_file_to_work_session(
        db,
        principal=principal,
        session_id=session_id,
        user_file=user_file,
        note=note,
    )


def attach_user_file_to_work_session(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
    user_file: UserFile,
    note: str | None,
) -> AgentSessionSource:
    thread = load_agent_thread_for_principal(db, thread_id=session_id, principal=principal)
    return attach_user_file_to_work_session_thread(
        db,
        thread=thread,
        user_file=user_file,
        note=note,
    )


def attach_user_file_to_work_session_thread(
    db: Session,
    *,
    thread: AgentThread,
    user_file: UserFile,
    note: str | None,
) -> AgentSessionSource:
    if user_file.owner_user_id != thread.owner_user_id:
        raise PolicyViolation.not_found("Source not found.")
    existing = db.scalar(
        select(AgentSessionSource).where(
            AgentSessionSource.thread_id == thread.id,
            AgentSessionSource.user_file_id == user_file.id,
        )
    )
    if existing is not None:
        if note is not None:
            existing.note = _normalize_text_or_none(note)
            db.add(existing)
            db.flush()
        return existing
    source = AgentSessionSource(
        thread_id=thread.id,
        user_file_id=user_file.id,
        note=_normalize_text_or_none(note),
    )
    thread.updated_at = utc_now()
    db.add_all([source, thread])
    db.flush()
    return source


def list_work_session_sources(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
) -> list[AgentSessionSourceRead]:
    thread = load_work_session(db, principal=principal, session_id=session_id)
    return [session_source_to_read(source) for source in thread.sources]


def ensure_external_agent_run(
    db: Session,
    *,
    principal: RequestPrincipal,
    session_id: str,
) -> AgentRun:
    thread = load_agent_thread_for_principal(db, thread_id=session_id, principal=principal)
    existing = db.scalar(
        select(AgentRun)
        .where(
            AgentRun.thread_id == thread.id,
            AgentRun.surface == EXTERNAL_AGENT_RUN_SURFACE,
            AgentRun.model_name == EXTERNAL_AGENT_MODEL_NAME,
        )
        .order_by(AgentRun.created_at.asc())
        .limit(1)
    )
    if existing is not None:
        return existing

    message = AgentMessage(
        thread_id=thread.id,
        role=AgentMessageRole.SYSTEM,
        content_markdown="External agent session actions.",
        attachments_use_ocr=False,
    )
    db.add(message)
    db.flush()
    run = AgentRun(
        thread_id=thread.id,
        user_message_id=message.id,
        status=AgentRunStatus.COMPLETED,
        model_name=EXTERNAL_AGENT_MODEL_NAME,
        surface=EXTERNAL_AGENT_RUN_SURFACE,
        completed_at=utc_now(),
    )
    db.add(run)
    db.flush()
    return run


def work_session_to_read(
    db: Session,
    *,
    thread: AgentThread,
    principal: RequestPrincipal,
) -> AgentSessionRead:
    return _session_to_read(db, thread=thread, principal=principal)


def session_source_to_read(source: AgentSessionSource) -> AgentSessionSourceRead:
    user_file = source.user_file
    return AgentSessionSourceRead(
        id=source.id,
        session_id=source.thread_id,
        source_id=user_file.id,
        display_name=_source_display_name(user_file),
        original_filename=user_file.original_filename,
        mime_type=user_file.mime_type,
        size_bytes=user_file.size_bytes,
        sha256=user_file.sha256,
        note=source.note,
        created_at=source.created_at,
    )


def _session_to_read(
    db: Session,
    *,
    thread: AgentThread,
    principal: RequestPrincipal,
) -> AgentSessionRead:
    pending_change_count = int(
        db.scalar(
            select(func.count(AgentChangeItem.id))
            .join(AgentRun, AgentRun.id == AgentChangeItem.run_id)
            .where(
                AgentRun.thread_id == thread.id,
                AgentChangeItem.status == AgentChangeStatus.PENDING_REVIEW,
                AgentChangeItem.change_type.in_(SUPPORTED_AGENT_CHANGE_TYPES),
            )
        )
        or 0
    )
    has_running_run = bool(
        db.scalar(
            select(AgentRun.id)
            .join(AgentThread, AgentThread.id == AgentRun.thread_id)
            .where(
                AgentRun.thread_id == thread.id,
                AgentRun.status == AgentRunStatus.RUNNING,
                agent_thread_owner_filter(principal),
            )
            .limit(1)
        )
    )
    return AgentSessionRead(
        id=thread.id,
        title=thread.title,
        summary=thread.summary,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        pending_change_count=pending_change_count,
        has_running_run=has_running_run,
    )


def _normalize_title_or_none(value: str | None) -> str | None:
    normalized = _normalize_text_or_none(value)
    if normalized is None:
        return None
    return validate_thread_title(normalized)


def _normalize_text_or_none(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def _safe_source_filename(value: str | None, *, fallback: str) -> str:
    raw = Path(value or fallback).name
    if not raw or raw in {".", ".."}:
        return fallback
    return raw


def _normalize_source_mime_type(
    *,
    mime_type: str | None,
    original_filename: str | None,
) -> str:
    normalized = " ".join((mime_type or "").split()).strip().lower()
    if normalized:
        return normalized
    guessed = mimetypes.guess_type(original_filename or "")[0]
    return (guessed or "application/octet-stream").lower()


def _validate_source_mime_type(mime_type: str) -> None:
    if is_supported_agent_attachment_mime(mime_type):
        return
    raise PolicyViolation.bad_request("Only text, image, and PDF sources are supported.")


def _source_display_name(user_file: UserFile) -> str:
    return (
        display_name_for_file(
            original_filename=user_file.original_filename,
            fallback_name=user_file.display_name or Path(user_file.stored_relative_path).name,
        )
        or user_file.id
    )
