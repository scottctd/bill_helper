# CALLING SPEC:
# - Purpose: define external-agent session markers and thread detection helpers.
# - Inputs: thread ids and SQLAlchemy sessions.
# - Outputs: marker text, detection predicates, and anchor-run persistence helpers.
# - Side effects: may insert a completed anchor run with a system transcript row.
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentRunStatus, AgentTranscriptRole
from backend.models_agent import AgentRun, AgentThread, AgentTranscriptMessage
from backend.models_shared import utc_now

EXTERNAL_AGENT_MODEL_NAME = "external-agent"
EXTERNAL_AGENT_RUN_ORIGIN = "cli"
EXTERNAL_SESSION_MARKER_PREFIX = "This session was started by an external agent"
LEGACY_EXTERNAL_RUN_ANCHOR_MESSAGE = "External agent session actions."


def external_session_system_message() -> str:
    return (
        "This session was started by an external agent using the `bh` CLI.\n\n"
        "For Bill Helper users: review pending proposals here. Chat history from the "
        "external agent is not shown in this timeline.\n\n"
        "For the hosted agent: if the user sends messages here, treat this as follow-up "
        "on external work. Inspect pending proposals and attached session sources before "
        "proposing changes; do not assume this is a fresh empty thread."
    )


def is_external_session_system_message(content: str) -> bool:
    stripped = content.strip()
    if stripped.startswith(EXTERNAL_SESSION_MARKER_PREFIX):
        return True
    return stripped == LEGACY_EXTERNAL_RUN_ANCHOR_MESSAGE


def _existing_external_anchor_run(db: Session, *, thread_id: str) -> AgentRun | None:
    return db.scalar(
        select(AgentRun)
        .where(
            AgentRun.thread_id == thread_id,
            AgentRun.origin == EXTERNAL_AGENT_RUN_ORIGIN,
            AgentRun.model_name == EXTERNAL_AGENT_MODEL_NAME,
        )
        .order_by(AgentRun.created_at.asc())
        .limit(1)
    )


def ensure_external_session_marker(db: Session, *, thread_id: str) -> AgentRun:
    existing = _existing_external_anchor_run(db, thread_id=thread_id)
    if existing is not None:
        return existing

    thread = db.get(AgentThread, thread_id)
    if thread is None:
        raise LookupError(f"thread not found: {thread_id}")
    run = AgentRun(
        thread_id=thread_id,
        turn_index=None,
        status=AgentRunStatus.COMPLETED,
        model_name=EXTERNAL_AGENT_MODEL_NAME,
        principal_user_id=thread.owner_user_id,
        metadata_json={},
        origin=EXTERNAL_AGENT_RUN_ORIGIN,
        completed_at=utc_now(),
    )
    db.add(run)
    db.flush()
    db.add(
        AgentTranscriptMessage(
            run_id=run.id,
            sequence_index=0,
            role=AgentTranscriptRole.SYSTEM,
            content_json={"content": external_session_system_message()},
        )
    )
    db.flush()
    return run


def thread_initiated_by_external_agent(db: Session, *, thread_id: str) -> bool:
    return _existing_external_anchor_run(db, thread_id=thread_id) is not None
