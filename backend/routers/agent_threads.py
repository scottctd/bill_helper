# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `agent_threads` routes.
# - Inputs: callers that import `backend/routers/agent_threads.py` and pass module-defined arguments or framework events.
# - Outputs: router callables and request/response adapters for `agent_threads`.
# - Side effects: FastAPI routing and HTTP error translation.
from __future__ import annotations

from collections.abc import Iterator
from threading import Thread
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, status, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.database import get_session_maker
from backend.enums_agent import (
    AgentApprovalPolicy,
    AgentChangeStatus,
    AgentRunStatus,
    SUPPORTED_AGENT_CHANGE_TYPES,
)
from backend.models_agent import (
    AgentChangeItem,
    AgentRun,
    AgentStep,
    AgentThread,
    AgentToolCall,
    AgentTranscriptAttachment,
    AgentTranscriptMessage,
)
from backend.models_import import ImportTask
from backend.schemas_agent import (
    AgentRunRead,
    AgentThreadCreate,
    AgentThreadDetailRead,
    AgentThreadRead,
    AgentThreadSummaryRead,
    AgentThreadUpdate,
)
from backend.services.access_scope import agent_thread_owner_filter, load_agent_thread_for_principal
from backend.services.agent.api_projection import build_thread_detail_projection, last_turn_preview_from_thread
from backend.services.agent.execution import (
    create_user_message_and_start_run,
    current_context_tokens_for_thread,
    run_agent_in_background,
)
from backend.services.agent.external_session import thread_initiated_by_external_agent
from backend.services.agent.sse import format_sse_event
from backend.services.agent.stream_hub import iter_run_stream_hub_events, start_run_stream_execution
from backend.services.agent.serializers import run_to_schema, thread_summary_to_schema, thread_to_schema
from backend.services.agent.threads import rename_thread_by_id
from backend.services.crud_policy import PolicyViolation
from backend.services.runtime_settings import resolve_runtime_settings

AgentSurface = Literal["app", "telegram"]

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
)


def _normalize_approval_policy_form(value: str | None) -> AgentApprovalPolicy:
    raw = (value or "").strip().lower()
    if not raw or raw == AgentApprovalPolicy.DEFAULT.value:
        return AgentApprovalPolicy.DEFAULT
    if raw == AgentApprovalPolicy.YOLO.value:
        return AgentApprovalPolicy.YOLO
    # Transport: multipart form validation before service intake.
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="approval_policy must be 'default' or 'yolo'.",
    )


def open_background_session() -> Session:
    return get_session_maker()()


async def create_user_message_run_or_503(
    *,
    thread_id: str,
    content: str,
    files: list[UploadFile],
    attachment_ids: list[str],
    attachments_use_ocr: bool,
    surface: AgentSurface,
    db: Session,
    model_name: str | None,
    approval_policy: AgentApprovalPolicy,
    principal: RequestPrincipal,
) -> AgentRun:
    return await create_user_message_and_start_run(
        thread_id=thread_id,
        content=content,
        files=files,
        attachment_ids=attachment_ids,
        attachments_use_ocr=attachments_use_ocr,
        db=db,
        model_name=model_name,
        surface=surface,
        approval_policy=approval_policy,
        principal_user_id=principal.user_id,
        principal_user_name=principal.user_name,
    )


def _thread_summary_rows(db: Session, *, principal: RequestPrincipal) -> list[AgentThreadSummaryRead]:
    import_thread_ids = select(ImportTask.thread_id)
    threads = list(
        db.scalars(
            select(AgentThread)
            .where(agent_thread_owner_filter(principal))
            .where(AgentThread.id.not_in(import_thread_ids))
            .options(
                selectinload(AgentThread.runs).selectinload(AgentRun.transcript_messages),
            )
            .order_by(AgentThread.updated_at.desc())
        )
    )
    running_thread_ids = set(
        db.scalars(
            select(AgentRun.thread_id)
            .join(AgentThread, AgentThread.id == AgentRun.thread_id)
            .where(AgentRun.status == AgentRunStatus.RUNNING)
            .where(agent_thread_owner_filter(principal))
            .distinct()
        )
    )
    summaries: list[AgentThreadSummaryRead] = []
    for thread in threads:
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
        summaries.append(
            thread_summary_to_schema(
                thread,
                last_message_preview=last_turn_preview_from_thread(thread),
                pending_change_count=pending_change_count,
                has_running_run=thread.id in running_thread_ids,
                initiated_by_external_agent=thread_initiated_by_external_agent(db, thread_id=thread.id),
            )
        )
    return summaries


@router.get("/threads", response_model=list[AgentThreadSummaryRead])
def list_threads(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[AgentThreadSummaryRead]:
    return _thread_summary_rows(db, principal=principal)


@router.post("/threads", response_model=AgentThreadRead, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: AgentThreadCreate | None = None,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentThreadRead:
    thread = AgentThread(owner_user_id=principal.user_id, title=payload.title if payload else None)
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread_to_schema(
        thread,
        initiated_by_external_agent=thread_initiated_by_external_agent(db, thread_id=thread.id),
    )


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(
    thread_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    thread = load_agent_thread_for_principal(
        db,
        thread_id=thread_id,
        principal=principal,
        stmt=select(AgentThread).options(selectinload(AgentThread.runs)),
    )

    if any(run.status == AgentRunStatus.RUNNING for run in thread.runs):
        raise PolicyViolation.conflict(
            "Cannot delete a thread while an agent run is still running.",
        )

    db.delete(thread)
    db.commit()


@router.patch("/threads/{thread_id}", response_model=AgentThreadRead)
def update_thread(
    thread_id: str,
    payload: AgentThreadUpdate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentThreadRead:
    load_agent_thread_for_principal(db, thread_id=thread_id, principal=principal)
    result = rename_thread_by_id(db, thread_id=thread_id, title=payload.title)
    return thread_to_schema(
        result.thread,
        initiated_by_external_agent=thread_initiated_by_external_agent(db, thread_id=result.thread.id),
    )


def _thread_detail_load_options():
    return (
        selectinload(AgentThread.runs)
        .selectinload(AgentRun.transcript_messages)
        .selectinload(AgentTranscriptMessage.attachments)
        .selectinload(AgentTranscriptAttachment.user_file),
        selectinload(AgentThread.runs)
        .selectinload(AgentRun.steps)
        .selectinload(AgentStep.assistant_message),
        selectinload(AgentThread.runs)
        .selectinload(AgentRun.tool_calls)
        .selectinload(AgentToolCall.step),
        selectinload(AgentThread.runs).selectinload(AgentRun.events),
        selectinload(AgentThread.runs)
        .selectinload(AgentRun.change_items)
        .selectinload(AgentChangeItem.review_actions),
    )


@router.get("/threads/{thread_id}", response_model=AgentThreadDetailRead)
def get_thread_detail(
    thread_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentThreadDetailRead:
    thread = load_agent_thread_for_principal(
        db,
        thread_id=thread_id,
        principal=principal,
        stmt=select(AgentThread).options(*_thread_detail_load_options()),
    )
    settings = resolve_runtime_settings(db)
    return build_thread_detail_projection(
        thread,
        api_prefix=settings.api_prefix,
        configured_model_name=settings.agent_model,
        current_context_tokens=current_context_tokens_for_thread(
            db,
            thread=thread,
            model_name=settings.agent_model,
        ),
        initiated_by_external_agent=thread_initiated_by_external_agent(db, thread_id=thread.id),
        include_tool_payload=False,
    )


@router.post("/threads/{thread_id}/messages", response_model=AgentRunRead)
async def send_thread_message(
    thread_id: str,
    content: str = Form(default=""),
    model_name: str | None = Form(default=None),
    attachments_use_ocr: bool = Form(default=False),
    approval_policy: str | None = Form(default=None),
    surface: AgentSurface = Form(default="app"),
    files: list[UploadFile] = File(default_factory=list),
    attachment_ids: list[str] = Form(default_factory=list),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentRunRead:
    load_agent_thread_for_principal(db, thread_id=thread_id, principal=principal)
    run = await create_user_message_run_or_503(
        thread_id=thread_id,
        content=content,
        files=files,
        attachment_ids=attachment_ids,
        attachments_use_ocr=attachments_use_ocr,
        surface=surface,
        db=db,
        model_name=model_name,
        approval_policy=_normalize_approval_policy_form(approval_policy),
        principal=principal,
    )
    Thread(
        target=run_agent_in_background,
        kwargs={"run_id": run.id, "session_factory": open_background_session},
        daemon=True,
    ).start()
    db.refresh(run)
    return run_to_schema(run)


@router.post("/threads/{thread_id}/messages/stream")
async def send_thread_message_stream(
    thread_id: str,
    content: str = Form(default=""),
    model_name: str | None = Form(default=None),
    attachments_use_ocr: bool = Form(default=False),
    approval_policy: str | None = Form(default=None),
    surface: AgentSurface = Form(default="app"),
    files: list[UploadFile] = File(default_factory=list),
    attachment_ids: list[str] = Form(default_factory=list),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> StreamingResponse:
    load_agent_thread_for_principal(db, thread_id=thread_id, principal=principal)
    run = await create_user_message_run_or_503(
        thread_id=thread_id,
        content=content,
        files=files,
        attachment_ids=attachment_ids,
        attachments_use_ocr=attachments_use_ocr,
        surface=surface,
        db=db,
        model_name=model_name,
        approval_policy=_normalize_approval_policy_form(approval_policy),
        principal=principal,
    )

    def stream_events() -> Iterator[str]:
        stream_finished = False
        try:
            for event in iter_run_stream_hub_events(
                db,
                run.id,
                after_sequence=0,
                session_factory=open_background_session,
            ):
                event_type = str(event.get("type") or "event")
                payload = dict(event)
                yield format_sse_event(event_type, payload)
            stream_finished = True
        finally:
            if not stream_finished:
                start_run_stream_execution(
                    run.id,
                    session_factory=open_background_session,
                )

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
