# CALLING SPEC:
# - Purpose: thread-title normalization plus rename persistence helpers.
# - Inputs: thread id or run id, validated title string, SQLAlchemy session.
# - Outputs: ThreadRenameResult with updated thread row.
# - Side effects: commits thread title updates; raises PolicyViolation when thread missing.
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from backend.models_agent import AgentRun, AgentThread
from backend.models_shared import utc_now
from backend.services.crud_policy import PolicyViolation
from backend.validation.agent_threads import validate_thread_title


@dataclass(slots=True)
class ThreadRenameResult:
    thread: AgentThread
    previous_title: str | None


def rename_thread_by_id(
    db: Session,
    *,
    thread_id: str,
    title: str,
) -> ThreadRenameResult:
    thread = db.get(AgentThread, thread_id)
    if thread is None:
        raise PolicyViolation.not_found("Thread not found")
    return _persist_thread_title(db, thread=thread, title=title)


def rename_thread_for_run(
    db: Session,
    *,
    run_id: str,
    title: str,
) -> ThreadRenameResult:
    run = db.get(AgentRun, run_id)
    if run is None:
        raise PolicyViolation.not_found("Thread not found")
    thread = db.get(AgentThread, run.thread_id)
    if thread is None:
        raise PolicyViolation.not_found("Thread not found")
    return _persist_thread_title(db, thread=thread, title=title)


def _persist_thread_title(
    db: Session,
    *,
    thread: AgentThread,
    title: str,
) -> ThreadRenameResult:
    normalized = validate_thread_title(title)
    previous_title = thread.title
    thread.title = normalized
    thread.updated_at = utc_now()
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return ThreadRenameResult(thread=thread, previous_title=previous_title)
