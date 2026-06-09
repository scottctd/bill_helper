# CALLING SPEC:
# - Purpose: public agent runtime facade over harness-first production runtime.
# - Inputs: DB session, thread/run ids, model configuration.
# - Outputs: run lifecycle helpers; model call seams for tests.
# - Side effects: harness execution through production_runtime.
from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from sqlalchemy.orm import Session

from backend.config import DEFAULT_AGENT_MODEL
from backend.enums_agent import AgentApprovalPolicy
from backend.models_agent import AgentRun, AgentThread
from backend.services.agent.context_tokens import count_context_tokens
from backend.services.agent.harness.contracts import HarnessPrincipal
from backend.services.agent.model_client import (
    LiteLLMModelClient,
    validate_litellm_environment,
)
from backend.services.agent.production_runtime import (
    execute_harness_run,
    interrupt_harness_run,
    resume_harness_run,
)
from backend.services.agent.tool_runtime import build_openai_tool_schemas
from backend.services.runtime_settings import resolve_runtime_settings
from backend.validation.runtime_settings import normalize_text_or_none


class AgentRuntimeUnavailable(RuntimeError):
    pass


def ensure_agent_available(db: Session, *, model_name: str | None = None) -> None:
    settings = resolve_runtime_settings(db)
    requested_model_name = normalize_text_or_none(model_name) or settings.agent_model
    if settings.agent_base_url or settings.agent_api_key:
        return
    has_credentials, missing_keys, request_model = validate_litellm_environment(
        model_name=requested_model_name,
    )
    if has_credentials:
        return
    missing_text = f" Missing keys: {', '.join(missing_keys)}." if missing_keys else ""
    raise AgentRuntimeUnavailable(
        "Agent runtime is not configured. "
        f"Model target: {request_model}.{missing_text} "
        "Provide provider credentials via environment variables or configure custom base_url and api_key in settings."
    )


def _build_model_client(db: Session, *, model_name: str | None = None) -> LiteLLMModelClient:
    settings = resolve_runtime_settings(db)
    selected_model_name = normalize_text_or_none(model_name) or settings.agent_model or DEFAULT_AGENT_MODEL
    return LiteLLMModelClient(
        model_name=selected_model_name,
        tools=build_openai_tool_schemas(),
        retry_max_attempts=settings.agent_retry_max_attempts,
        retry_initial_wait_seconds=settings.agent_retry_initial_wait_seconds,
        retry_max_wait_seconds=settings.agent_retry_max_wait_seconds,
        retry_backoff_multiplier=settings.agent_retry_backoff_multiplier,
        base_url=settings.agent_base_url,
        api_key=settings.agent_api_key,
    )


def call_model(
    messages: list[dict[str, Any]],
    db: Session,
    *,
    model_name: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: Any = None,
    response_format: Any = None,
    litellm_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _build_model_client(db, model_name=model_name).complete(
        messages,
        tools=tools,
        tool_choice=tool_choice,
        response_format=response_format,
        litellm_metadata=litellm_metadata,
    )


def call_model_stream(
    messages: list[dict[str, Any]],
    db: Session,
    *,
    model_name: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: Any = None,
    response_format: Any = None,
    litellm_metadata: dict[str, Any] | None = None,
) -> Iterator[dict[str, Any]]:
    return _build_model_client(db, model_name=model_name).complete_stream(
        messages,
        tools=tools,
        tool_choice=tool_choice,
        response_format=response_format,
        litellm_metadata=litellm_metadata,
    )


def calculate_context_tokens(
    *,
    model_name: str,
    llm_messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> int | None:
    return count_context_tokens(
        model_name=model_name,
        messages=llm_messages,
        tools=tools if tools is not None else build_openai_tool_schemas(),
    )


def start_agent_run(
    db: Session,
    thread: AgentThread,
    *,
    run_id: str,
) -> AgentRun:
    execute_harness_run(db, run_id, streaming=True)
    run_row = db.get(AgentRun, run_id)
    if run_row is None:
        raise RuntimeError(f"run not found after execution: {run_id}")
    return run_row


def run_existing_agent_run(db: Session, run_id: str) -> AgentRun | None:
    try:
        resume_harness_run(db, run_id, streaming=False)
    except LookupError:
        return None
    return db.get(AgentRun, run_id)


def run_existing_agent_run_stream(db: Session, run_id: str) -> Iterator[dict[str, Any]]:
    from backend.services.agent.production_events import harness_event_to_sse_payload
    from backend.services.agent.stream_hub import publish_run_stream_event

    run_row = db.get(AgentRun, run_id)
    if run_row is None:
        return
    if run_row.status.value != "running":
        for event_row in sorted(run_row.events, key=lambda row: row.sequence_index):
            payload = {
                "type": event_row.event_type.value,
                **(event_row.payload_json or {}),
            }
            yield payload
        return

    resume_harness_run(db, run_id, streaming=True)
    yield from ()


def interrupt_agent_run(
    db: Session, run_id: str, *, reason: str = "Run interrupted by user."
) -> AgentRun | None:
    return interrupt_harness_run(db, run_id)
