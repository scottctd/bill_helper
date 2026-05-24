# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `agent_runs` routes.
# - Inputs: callers that import `backend/routers/agent_runs.py` and pass module-defined arguments or framework events.
# - Outputs: router callables and request/response adapters for `agent_runs`.
# - Side effects: FastAPI routing and HTTP error translation.
from __future__ import annotations

from collections.abc import Iterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.database import get_session_maker
from backend.models_agent import AgentChangeItem, AgentRun, AgentToolCall
from backend.schemas_agent import AgentRunRead, AgentToolCallRead
from backend.services.access_scope import load_agent_run_for_principal, load_tool_call_for_principal
from backend.services.agent.runtime import interrupt_agent_run
from backend.services.agent.serializers import run_to_schema, tool_call_to_schema
from backend.services.agent.sse import format_sse_event
from backend.services.agent.stream_hub import iter_run_stream_hub_events, start_run_stream_execution

AgentSurface = Literal["app", "telegram"]

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
)


def open_background_session() -> Session:
    return get_session_maker()()


@router.get("/runs/{run_id}/stream")
def stream_run(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> StreamingResponse:
    load_agent_run_for_principal(db, run_id=run_id, principal=principal)

    def stream_events() -> Iterator[str]:
        stream_finished = False
        try:
            for event in iter_run_stream_hub_events(
                db,
                run_id,
                after_sequence=after_sequence,
                session_factory=open_background_session,
            ):
                event_type = str(event.get("type") or "event")
                payload = dict(event)
                yield format_sse_event(event_type, payload)
            stream_finished = True
        finally:
            if not stream_finished:
                start_run_stream_execution(
                    run_id,
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


@router.get("/runs/{run_id}", response_model=AgentRunRead)
def get_run(
    run_id: str,
    surface: AgentSurface | None = Query(default=None),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentRunRead:
    run = load_agent_run_for_principal(
        db,
        run_id=run_id,
        principal=principal,
        stmt=select(AgentRun).options(
            selectinload(AgentRun.assistant_message),
            selectinload(AgentRun.events),
            selectinload(AgentRun.tool_calls),
            selectinload(AgentRun.change_items).selectinload(AgentChangeItem.review_actions),
        ),
    )
    return run_to_schema(run, surface=surface)


@router.get("/tool-calls/{tool_call_id}", response_model=AgentToolCallRead)
def get_tool_call(
    tool_call_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentToolCallRead:
    tool_call = load_tool_call_for_principal(db, tool_call_id=tool_call_id, principal=principal)
    return tool_call_to_schema(tool_call, include_payload=True)


@router.post("/runs/{run_id}/interrupt", response_model=AgentRunRead)
def interrupt_run(
    run_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentRunRead:
    load_agent_run_for_principal(db, run_id=run_id, principal=principal)
    run = interrupt_agent_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run_to_schema(run)
