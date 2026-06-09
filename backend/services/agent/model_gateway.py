# CALLING SPEC:
# - Purpose: LiteLLM ModelGateway adapter for AgentHarness.
# - Inputs: ModelRequest with canonical transcript; optional EventSink for streaming deltas.
# - Outputs: normalized ModelDecision after provider completion.
# - Side effects: network calls to model provider via LiteLLM.
from __future__ import annotations

import time
from typing import Any

from sqlalchemy.orm import Session

from backend.config import DEFAULT_AGENT_MODEL
from backend.models_agent import AgentRun, AgentThread
from backend.services.agent.harness.contracts import (
    ModelDecision,
    ModelDeltaEvent,
    ModelRequest,
)
from backend.services.agent.harness.errors import HarnessProviderError
from backend.services.agent.harness.events import EventSink, NullEventSink
from backend.services.agent.model_client import AgentModelError, LiteLLMModelClient
from backend.services.agent.model_gateway_support.conversion import (
    canonical_transcript_to_provider,
    provider_response_to_decision,
)
from backend.services.agent.model_gateway_support.transcript_hydration import (
    hydrate_transcript_user_attachments,
)
from backend.services.agent.tool_runtime import build_openai_tool_schemas
from backend.services.agent.tools_for_model_request import tools_for_agent_model_request
from backend.services.runtime_settings import resolve_runtime_settings
from backend.validation.runtime_settings import normalize_text_or_none

_RENAME_THREAD_TOOL_NAME = "rename_thread"


class LiteLLMModelGateway:
    def __init__(
        self,
        db: Session,
        *,
        event_sink: EventSink | None = None,
        step_index: int = 0,
        run_id: str = "",
    ) -> None:
        self._db = db
        self._event_sink = event_sink or NullEventSink()
        self._step_index = step_index
        self._run_id = run_id

    def _build_client(self, model_name: str, *, tools: list[dict[str, Any]]) -> LiteLLMModelClient:
        settings = resolve_runtime_settings(self._db)
        selected = normalize_text_or_none(model_name) or settings.agent_model or DEFAULT_AGENT_MODEL
        return LiteLLMModelClient(
            model_name=selected,
            tools=tools,
            retry_max_attempts=settings.agent_retry_max_attempts,
            retry_initial_wait_seconds=settings.agent_retry_initial_wait_seconds,
            retry_max_wait_seconds=settings.agent_retry_max_wait_seconds,
            retry_backoff_multiplier=settings.agent_retry_backoff_multiplier,
            base_url=settings.agent_base_url,
            api_key=settings.agent_api_key,
        )

    def _model_request_kwargs(
        self,
        *,
        thread: AgentThread | None,
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if thread is None or thread.title is not None:
            return {"tools": tools}
        return {
            "tools": build_openai_tool_schemas(tool_names=[_RENAME_THREAD_TOOL_NAME]),
            "tool_choice": {
                "type": "function",
                "function": {"name": _RENAME_THREAD_TOOL_NAME},
            },
        }

    def _normalize_decision_for_thread(
        self,
        decision: ModelDecision,
        *,
        thread: AgentThread | None,
    ) -> ModelDecision:
        if thread is None or thread.title is not None or len(decision.tool_requests) <= 1:
            return decision
        rename_requests = [
            request
            for request in decision.tool_requests
            if request.tool_name == _RENAME_THREAD_TOOL_NAME
        ]
        if len(rename_requests) <= 1:
            return decision
        return decision.model_copy(update={"tool_requests": [rename_requests[0]]})

    def _resolve_thread(self, request: ModelRequest) -> AgentThread | None:
        thread_id = request.trace_metadata.get("thread_id")
        if thread_id:
            return self._db.get(AgentThread, str(thread_id))
        run_id = request.trace_metadata.get("run_id")
        if not run_id:
            return None
        run_row = self._db.get(AgentRun, str(run_id))
        if run_row is None or run_row.thread_id is None:
            return None
        return self._db.get(AgentThread, run_row.thread_id)

    def _provider_messages(self, request: ModelRequest) -> list[dict[str, Any]]:
        run_id = str(request.trace_metadata.get("run_id") or self._run_id or "")
        transcript = request.transcript
        if run_id:
            transcript = hydrate_transcript_user_attachments(
                self._db,
                run_id=run_id,
                transcript=transcript,
                attachments_use_ocr=False,
            )
        return canonical_transcript_to_provider(transcript)

    def complete(self, request: ModelRequest) -> ModelDecision:
        thread = self._resolve_thread(request)
        tools = tools_for_agent_model_request(thread_title=thread.title if thread else None)
        client = self._build_client(request.model_params.model_name, tools=tools)
        provider_messages = self._provider_messages(request)
        request_kwargs = self._model_request_kwargs(thread=thread, tools=tools)
        started = time.monotonic()
        try:
            response = client.complete(
                provider_messages,
                litellm_metadata=dict(request.trace_metadata),
                **request_kwargs,
            )
        except AgentModelError as exc:
            raise HarnessProviderError(str(exc)) from exc
        latency_ms = int((time.monotonic() - started) * 1000)
        decision = provider_response_to_decision(
            response,
            provider_model=request.model_params.model_name,
            latency_ms=latency_ms,
        )
        return self._normalize_decision_for_thread(decision, thread=thread)


class StreamingLiteLLMModelGateway(LiteLLMModelGateway):
    def complete(self, request: ModelRequest) -> ModelDecision:
        step_index = int(request.trace_metadata.get("step_index") or self._step_index)
        thread = self._resolve_thread(request)
        tools = tools_for_agent_model_request(thread_title=thread.title if thread else None)
        client = self._build_client(request.model_params.model_name, tools=tools)
        provider_messages = self._provider_messages(request)
        request_kwargs = self._model_request_kwargs(thread=thread, tools=tools)
        started = time.monotonic()
        final_message: dict[str, Any] | None = None
        try:
            for chunk in client.complete_stream(
                provider_messages,
                litellm_metadata=dict(request.trace_metadata),
                **request_kwargs,
            ):
                chunk_type = chunk.get("type")
                if chunk_type == "reasoning_delta":
                    self._event_sink.publish(
                        ModelDeltaEvent(
                            run_id=self._run_id,
                            step_index=step_index,
                            delta_type="reasoning",
                            text=str(chunk.get("delta") or ""),
                        )
                    )
                elif chunk_type == "text_delta":
                    self._event_sink.publish(
                        ModelDeltaEvent(
                            run_id=self._run_id,
                            step_index=step_index,
                            delta_type="content",
                            text=str(chunk.get("delta") or ""),
                        )
                    )
                elif chunk_type == "done":
                    final_message = chunk.get("message") or {}
        except AgentModelError as exc:
            raise HarnessProviderError(str(exc)) from exc
        if final_message is None:
            raise HarnessProviderError("streaming model response ended without done event")
        latency_ms = int((time.monotonic() - started) * 1000)
        decision = provider_response_to_decision(
            final_message,
            provider_model=request.model_params.model_name,
            latency_ms=latency_ms,
        )
        return self._normalize_decision_for_thread(decision, thread=thread)
