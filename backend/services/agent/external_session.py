# CALLING SPEC:
# - Purpose: define external-agent session markers and thread detection helpers.
# - Inputs: thread ids, persisted message content, SQLAlchemy sessions.
# - Outputs: marker text, detection predicates, and marker persistence helpers.
# - Side effects: may insert a system message row when seeding an external session.
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentMessageRole
from backend.models_agent import AgentMessage, AgentRun

EXTERNAL_AGENT_MODEL_NAME = "external-agent"
EXTERNAL_AGENT_RUN_SURFACE = "cli"
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


def ensure_external_session_marker(db: Session, *, thread_id: str) -> AgentMessage:
    existing = db.scalar(
        select(AgentMessage)
        .where(
            AgentMessage.thread_id == thread_id,
            AgentMessage.role == AgentMessageRole.SYSTEM,
        )
        .order_by(AgentMessage.created_at.asc())
        .limit(1)
    )
    if existing is not None and is_external_session_system_message(existing.content_markdown):
        return existing

    message = AgentMessage(
        thread_id=thread_id,
        role=AgentMessageRole.SYSTEM,
        content_markdown=external_session_system_message(),
        attachments_use_ocr=False,
    )
    db.add(message)
    db.flush()
    return message


def thread_initiated_by_external_agent(db: Session, *, thread_id: str) -> bool:
    if db.scalar(
        select(AgentMessage.id)
        .where(
            AgentMessage.thread_id == thread_id,
            AgentMessage.role == AgentMessageRole.SYSTEM,
            AgentMessage.content_markdown.startswith(EXTERNAL_SESSION_MARKER_PREFIX),
        )
        .limit(1)
    ):
        return True
    return (
        db.scalar(
            select(AgentRun.id)
            .where(
                AgentRun.thread_id == thread_id,
                AgentRun.surface == EXTERNAL_AGENT_RUN_SURFACE,
                AgentRun.model_name == EXTERNAL_AGENT_MODEL_NAME,
            )
            .limit(1)
        )
        is not None
    )
