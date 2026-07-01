# CALLING SPEC:
# - Purpose: SQLAlchemy RunRepository for harness canonical state persistence.
# - Inputs: RunRequest, PreparedStep, tool results, RunResult; SQLAlchemy Session.
# - Outputs: RunState load/create/transition with durable resumable steps.
# - Side effects: database writes to agent_runs, transcript, steps, tool_calls, events only.
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.enums_agent import (
    AgentRunEventType,
    AgentRunStatus,
    AgentStepStatus,
    AgentToolCallStatus,
    AgentTranscriptRole,
)
from backend.models_agent import (
    AgentRun,
    AgentRunEvent,
    AgentStep,
    AgentToolCall,
    AgentTranscriptMessage,
)
from backend.services.agent.harness.contracts import (
    AssistantMessage,
    HarnessApprovalPolicy,
    HarnessModelConfig,
    HarnessPrincipal,
    HarnessRunOrigin,
    HarnessRunStatus,
    HarnessTerminalError,
    ModelUsage,
    PreparedStep,
    RunRequest,
    RunResult,
    RunState,
    StepRecord,
    SystemMessage,
    ToolCallRecord,
    ToolRequest,
    ToolResultMessage,
    TranscriptMessage,
    TranscriptMessageRecord,
    UserMessage,
)
from backend.services.agent.harness.errors import HarnessPersistenceError
from backend.services.agent.harness.transcript import validate_initial_transcript
from backend.services.agent.harness.tools import ToolExecutionResult
from backend.services.agent.production_events import enrich_harness_event_for_publication
from backend.services.agent.tool_runtime_support.catalog import TOOLS
from backend.services.agent.tool_runtime_support.definitions import AgentToolDefinition


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _add_optional(current: int | None, addition: int | None) -> int | None:
    if current is None and addition is None:
        return None
    return (current or 0) + (addition or 0)


def _harness_status_to_orm(status: HarnessRunStatus) -> AgentRunStatus:
    return AgentRunStatus(status.value)


def _orm_status_to_harness(status: AgentRunStatus) -> HarnessRunStatus:
    return HarnessRunStatus(status.value)


def _message_to_role(message: TranscriptMessage) -> AgentTranscriptRole:
    return AgentTranscriptRole(message.role)


def _content_json_for_message(message: TranscriptMessage) -> dict[str, Any]:
    if isinstance(message, SystemMessage):
        return {"content": message.content}
    if isinstance(message, UserMessage):
        if isinstance(message.content, str):
            return {"content": message.content}
        return {"content": [part.model_dump() for part in message.content]}
    if isinstance(message, AssistantMessage):
        payload: dict[str, Any] = {"content": message.content}
        if message.tool_requests:
            payload["tool_requests"] = [tr.model_dump() for tr in message.tool_requests]
        return payload
    if isinstance(message, ToolResultMessage):
        if isinstance(message.content, str):
            content: Any = message.content
        else:
            content = [part.model_dump() for part in message.content]
        return {
            "content": content,
            "is_error": message.is_error,
        }
    raise HarnessPersistenceError(f"unsupported message type: {type(message)}")


def _content_part_from_dict(part: dict[str, Any]):
    from backend.services.agent.harness.contracts import ImageUrlContentPart, TextContentPart

    if part.get("type") == "image_url":
        return ImageUrlContentPart.model_validate(part)
    return TextContentPart.model_validate(part)


def _record_from_orm_row(row: AgentTranscriptMessage) -> TranscriptMessageRecord:
    role = row.role.value
    payload = dict(row.content_json or {})
    if role == "system":
        message: TranscriptMessage = SystemMessage(content=str(payload.get("content") or ""))
    elif role == "user":
        raw_content = payload.get("content")
        if isinstance(raw_content, list):
            message = UserMessage(content=[_content_part_from_dict(part) for part in raw_content])
        else:
            message = UserMessage(content=str(raw_content or ""))
    elif role == "assistant":
        tool_requests = [
            ToolRequest.model_validate(tr) for tr in (payload.get("tool_requests") or [])
        ]
        message = AssistantMessage(
            content=str(payload.get("content") or ""),
            reasoning_text=row.reasoning_text,
            tool_requests=tool_requests,
        )
    else:
        raw_content = payload.get("content")
        message = ToolResultMessage(
            tool_request_id=str(row.tool_request_id or ""),
            tool_name=str(row.tool_name or ""),
            content=raw_content if raw_content is not None else "",
            is_error=bool(payload.get("is_error")),
        )
    return TranscriptMessageRecord(
        id=row.id,
        sequence_index=row.sequence_index,
        message=message,
    )


def _tool_result_content(payload: dict[str, Any] | None) -> str | list[Any] | None:
    if not isinstance(payload, dict):
        return None
    if "content" in payload:
        return payload.get("content")
    if "summary" in payload:
        return payload.get("content")
    return None


def _tool_result_output_json(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    output_json = payload.get("output_json")
    if isinstance(output_json, dict):
        return dict(output_json)
    if "summary" in payload:
        return dict(payload)
    return None


class SqlAlchemyRunRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, request: RunRequest) -> RunState:
        validate_initial_transcript(request.initial_transcript)
        run_row = AgentRun(
            id=request.run_id,
            thread_id=request.thread_id,
            turn_index=request.turn_index,
            status=AgentRunStatus.RUNNING,
            model_name=request.model_params.model_name,
            principal_user_id=request.principal.user_id,
            principal_user_name=request.principal.user_name,
            metadata_json=dict(request.metadata),
            origin=request.origin.surface,
            approval_policy=request.approval_policy.value,
            max_steps=request.max_steps,
        )
        self._db.add(run_row)
        self._db.flush()
        owned_transcript = request.owned_transcript or request.initial_transcript
        for index, message in enumerate(owned_transcript):
            row = AgentTranscriptMessage(
                run_id=run_row.id,
                sequence_index=index,
                role=_message_to_role(message),
                content_json=_content_json_for_message(message),
                reasoning_text=getattr(message, "reasoning_text", None),
                tool_request_id=getattr(message, "tool_request_id", None),
                tool_name=getattr(message, "tool_name", None),
            )
            self._db.add(row)
        self._db.commit()
        return self._state_from_orm(run_row, initial_transcript=request.initial_transcript)

    def load(self, run_id: str) -> RunState:
        run_row = self._db.scalar(
            select(AgentRun)
            .where(AgentRun.id == run_id)
            .options(
                selectinload(AgentRun.transcript_messages),
                selectinload(AgentRun.steps),
                selectinload(AgentRun.tool_calls),
            )
        )
        if run_row is None:
            raise HarnessPersistenceError(f"run not found: {run_id}")
        return self._state_from_orm(run_row)

    def prepare_step(self, previous_state: RunState, prepared_step: PreparedStep) -> RunState:
        current_status = self._db.scalar(
            select(AgentRun.status).where(AgentRun.id == previous_state.run_id)
        )
        if current_status != AgentRunStatus.RUNNING:
            return previous_state

        run_row = self._db.get(AgentRun, previous_state.run_id)
        if run_row is None:
            raise HarnessPersistenceError(f"run not found: {previous_state.run_id}")

        assistant = prepared_step.assistant
        assistant_row = AgentTranscriptMessage(
            id=assistant.id,
            run_id=run_row.id,
            sequence_index=assistant.sequence_index,
            role=AgentTranscriptRole.ASSISTANT,
            content_json=_content_json_for_message(assistant.message),
            reasoning_text=assistant.message.reasoning_text
            if isinstance(assistant.message, AssistantMessage)
            else None,
        )
        self._db.add(assistant_row)

        step_record = prepared_step.step
        step_row = AgentStep(
            id=step_record.id,
            run_id=run_row.id,
            step_index=step_record.step_index,
            assistant_transcript_message_id=assistant.id,
            status=AgentStepStatus.RUNNING,
            input_tokens=step_record.usage.input_tokens,
            output_tokens=step_record.usage.output_tokens,
            cache_read_tokens=step_record.usage.cache_read_tokens,
            cache_write_tokens=step_record.usage.cache_write_tokens,
            finish_reason=step_record.finish_reason,
            latency_ms=step_record.latency_ms,
        )
        self._db.add(step_row)
        self._db.flush()

        for tool_call in prepared_step.tool_calls:
            self._db.add(
                AgentToolCall(
                    id=tool_call.id,
                    run_id=run_row.id,
                    step_id=step_row.id,
                    call_index=tool_call.call_index,
                    tool_request_id=tool_call.tool_request_id,
                    tool_name=tool_call.tool_name,
                    arguments_json=dict(tool_call.arguments_json),
                    status=AgentToolCallStatus.QUEUED,
                )
            )

        self._db.commit()
        return self.load(run_row.id)

    def mark_tool_running(self, run_id: str, tool_call_id: str) -> RunState:
        tool_call = self._db.get(AgentToolCall, tool_call_id)
        if tool_call is None or tool_call.run_id != run_id:
            raise HarnessPersistenceError(f"tool call not found: {tool_call_id}")
        if tool_call.status == AgentToolCallStatus.QUEUED:
            tool_call.status = AgentToolCallStatus.RUNNING
            tool_call.started_at = _utc_now()
            self._db.commit()
        return self.load(run_id)

    def commit_tool_result(
        self,
        run_id: str,
        tool_call_id: str,
        result: ToolExecutionResult,
    ) -> RunState:
        tool_call = self._db.get(AgentToolCall, tool_call_id)
        if tool_call is None or tool_call.run_id != run_id:
            raise HarnessPersistenceError(f"tool call not found: {tool_call_id}")
        if tool_call.status in {
            AgentToolCallStatus.OK,
            AgentToolCallStatus.ERROR,
            AgentToolCallStatus.CANCELLED,
        }:
            return self.load(run_id)

        current_max = self._db.scalar(
            select(AgentTranscriptMessage.sequence_index)
            .where(AgentTranscriptMessage.run_id == run_id)
            .order_by(AgentTranscriptMessage.sequence_index.desc())
            .limit(1)
        )
        message = ToolResultMessage(
            tool_request_id=tool_call.tool_request_id,
            tool_name=tool_call.tool_name,
            content=result.content,
            is_error=result.is_error,
        )
        self._db.add(
            AgentTranscriptMessage(
                run_id=run_id,
                sequence_index=int(current_max if current_max is not None else -1) + 1,
                role=AgentTranscriptRole.TOOL,
                content_json=_content_json_for_message(message),
                tool_request_id=message.tool_request_id,
                tool_name=message.tool_name,
            )
        )
        result_payload: dict[str, Any] = {
            "content": _content_json_for_message(message)["content"]
        }
        if result.output_json is not None:
            result_payload["output_json"] = dict(result.output_json)
        tool_call.status = AgentToolCallStatus.ERROR if result.is_error else AgentToolCallStatus.OK
        tool_call.result_content_json = result_payload
        tool_call.error_code = result.error_code
        tool_call.completed_at = _utc_now()
        self._db.commit()
        return self.load(run_id)

    def finalize_step(self, run_id: str, step_id: str) -> RunState:
        step = self._db.get(AgentStep, step_id)
        if step is None or step.run_id != run_id:
            raise HarnessPersistenceError(f"step not found: {step_id}")
        if step.status == AgentStepStatus.COMMITTED:
            return self.load(run_id)
        unfinished = self._db.scalar(
            select(AgentToolCall.id)
            .where(
                AgentToolCall.step_id == step_id,
                AgentToolCall.status.in_(
                    [AgentToolCallStatus.QUEUED, AgentToolCallStatus.RUNNING]
                ),
            )
            .limit(1)
        )
        if unfinished is not None:
            raise HarnessPersistenceError(f"step has unfinished tools: {step_id}")

        run_row = self._db.get(AgentRun, run_id)
        assistant = self._db.get(AgentTranscriptMessage, step.assistant_transcript_message_id)
        if run_row is None or assistant is None:
            raise HarnessPersistenceError(f"incomplete persisted step: {step_id}")
        step.status = AgentStepStatus.COMMITTED
        run_row.input_tokens = _add_optional(run_row.input_tokens, step.input_tokens)
        run_row.output_tokens = _add_optional(run_row.output_tokens, step.output_tokens)
        run_row.cache_read_tokens = _add_optional(
            run_row.cache_read_tokens, step.cache_read_tokens
        )
        run_row.cache_write_tokens = _add_optional(
            run_row.cache_write_tokens, step.cache_write_tokens
        )
        if not (assistant.content_json or {}).get("tool_requests"):
            run_row.final_transcript_message_id = assistant.id
        self._db.commit()
        return self.load(run_id)

    def finish(self, run_result: RunResult) -> bool:
        run_row = self._db.get(AgentRun, run_result.run_id)
        if run_row is None:
            raise HarnessPersistenceError(f"run not found: {run_result.run_id}")
        if run_row.status != AgentRunStatus.RUNNING:
            return False
        run_row.status = _harness_status_to_orm(run_result.status)
        run_row.completed_at = _utc_now()
        if run_result.terminal_error:
            run_row.error_code = run_result.terminal_error.code
            run_row.error_detail = run_result.terminal_error.detail
        self._db.commit()
        return True

    def request_stop(self, run_id: str) -> None:
        run_row = self._db.get(AgentRun, run_id)
        if run_row is None:
            raise HarnessPersistenceError(f"run not found: {run_id}")
        run_row.stop_requested = True
        self._db.commit()

    def finalize_interrupt(
        self,
        run_id: str,
        *,
        detail: str = "run interrupted by user",
    ) -> bool:
        run_row = self._db.scalar(
            select(AgentRun)
            .where(AgentRun.id == run_id)
            .options(selectinload(AgentRun.tool_calls))
        )
        if run_row is None:
            raise HarnessPersistenceError(f"run not found: {run_id}")
        if run_row.status != AgentRunStatus.RUNNING:
            return False

        run_row.stop_requested = True
        run_row.status = AgentRunStatus.INTERRUPTED
        run_row.error_code = "interrupted"
        run_row.error_detail = detail
        run_row.completed_at = _utc_now()

        for tool_call in run_row.tool_calls:
            if tool_call.status in {
                AgentToolCallStatus.QUEUED,
                AgentToolCallStatus.RUNNING,
            }:
                tool_call.status = AgentToolCallStatus.CANCELLED
                tool_call.completed_at = _utc_now()
                self._db.add(tool_call)

        self._db.commit()
        return True

    def ensure_run_finished_event(self, run_result: RunResult) -> None:
        existing = self._db.scalar(
            select(AgentRunEvent.id)
            .where(
                AgentRunEvent.run_id == run_result.run_id,
                AgentRunEvent.event_type == AgentRunEventType.RUN_FINISHED,
            )
            .limit(1)
        )
        if existing is not None:
            return

        current_max = self._db.scalar(
            select(AgentRunEvent.sequence_index)
            .where(AgentRunEvent.run_id == run_result.run_id)
            .order_by(AgentRunEvent.sequence_index.desc())
            .limit(1)
        )
        next_sequence = int(current_max if current_max is not None else 0) + 1
        from backend.services.agent.harness.contracts import RunFinishedEvent

        self._db.add(
            AgentRunEvent(
                run_id=run_result.run_id,
                sequence_index=next_sequence,
                event_type=AgentRunEventType.RUN_FINISHED,
                payload_json=RunFinishedEvent(
                    run_id=run_result.run_id,
                    status=run_result.status,
                    final_assistant_content=run_result.final_assistant_content,
                    terminal_error=run_result.terminal_error,
                ).model_dump(),
            )
        )
        self._db.commit()

    def _owned_transcript_from_orm(self, run_row: AgentRun) -> list[TranscriptMessageRecord]:
        return [
            _record_from_orm_row(row) for row in sorted(run_row.transcript_messages, key=lambda r: r.sequence_index)
        ]

    def _assembled_transcript_from_orm(self, run_row: AgentRun) -> list[TranscriptMessageRecord]:
        owned = self._owned_transcript_from_orm(run_row)
        if run_row.thread_id is None or run_row.turn_index is None:
            return owned

        prior_runs = list(
            self._db.scalars(
                select(AgentRun)
                .where(
                    AgentRun.thread_id == run_row.thread_id,
                    AgentRun.turn_index.is_not(None),
                    AgentRun.turn_index < run_row.turn_index,
                )
                .options(selectinload(AgentRun.transcript_messages))
                .order_by(AgentRun.turn_index.asc(), AgentRun.created_at.asc())
            )
        )
        assembled: list[TranscriptMessageRecord] = []
        current_system = next(
            (record for record in owned if isinstance(record.message, SystemMessage)),
            None,
        )
        if current_system is not None:
            assembled.append(current_system)
        for prior_run in prior_runs:
            for record in self._owned_transcript_from_orm(prior_run):
                if not isinstance(record.message, SystemMessage):
                    assembled.append(record)
        assembled.extend(
            record for record in owned if not isinstance(record.message, SystemMessage)
        )
        return [
            record.model_copy(update={"sequence_index": index})
            for index, record in enumerate(assembled)
        ]

    def _state_from_orm(
        self,
        run_row: AgentRun,
        *,
        initial_transcript: list[TranscriptMessage] | None = None,
    ) -> RunState:
        if initial_transcript is None:
            transcript = self._assembled_transcript_from_orm(run_row)
        else:
            owned_by_message = {
                record.message.model_dump_json(): record
                for record in self._owned_transcript_from_orm(run_row)
            }
            transcript = []
            for index, message in enumerate(initial_transcript):
                owned = owned_by_message.get(message.model_dump_json())
                transcript.append(
                    TranscriptMessageRecord(
                        id=owned.id if owned is not None else f"context-{run_row.id}-{index}",
                        sequence_index=index,
                        message=message,
                    )
                )
        steps = [
            StepRecord(
                id=step.id,
                step_index=step.step_index,
                assistant_message_id=step.assistant_transcript_message_id,
                status=step.status.value,
                usage=ModelUsage(
                    input_tokens=step.input_tokens,
                    output_tokens=step.output_tokens,
                    cache_read_tokens=step.cache_read_tokens,
                    cache_write_tokens=step.cache_write_tokens,
                ),
                finish_reason=step.finish_reason,
                latency_ms=step.latency_ms,
            )
            for step in sorted(run_row.steps, key=lambda s: s.step_index)
        ]
        tool_calls = [
            ToolCallRecord(
                id=tc.id,
                step_id=tc.step_id,
                call_index=tc.call_index,
                tool_request_id=tc.tool_request_id,
                tool_name=tc.tool_name,
                arguments_json=dict(tc.arguments_json),
                status=tc.status.value,
                result_content=_tool_result_content(tc.result_content_json),
                output_json=_tool_result_output_json(tc.result_content_json),
                error_code=tc.error_code,
                started_at=tc.started_at,
                completed_at=tc.completed_at,
            )
            for tc in sorted(run_row.tool_calls, key=lambda t: t.call_index)
        ]
        terminal_error = None
        if run_row.error_code:
            terminal_error = HarnessTerminalError(
                code=run_row.error_code,
                detail=run_row.error_detail or "",
            )
        final_content = None
        if run_row.final_transcript_message_id:
            for record in transcript:
                if record.id == run_row.final_transcript_message_id and isinstance(
                    record.message, AssistantMessage
                ):
                    final_content = record.message.content
        return RunState(
            run_id=run_row.id,
            thread_id=run_row.thread_id,
            turn_index=run_row.turn_index,
            principal=HarnessPrincipal(
                user_id=run_row.principal_user_id,
                user_name=run_row.principal_user_name,
            ),
            model_params=HarnessModelConfig(model_name=run_row.model_name),
            tool_catalog=tool_definitions_from_catalog(list(TOOLS.values())),
            max_steps=run_row.max_steps,
            approval_policy=HarnessApprovalPolicy(run_row.approval_policy.value),
            origin=HarnessRunOrigin(surface=run_row.origin),
            metadata=dict(run_row.metadata_json or {}),
            transcript=transcript,
            steps=steps,
            tool_calls=tool_calls,
            completed_steps=sum(step.status == "committed" for step in steps),
            status=_orm_status_to_harness(run_row.status),
            stop_requested=run_row.stop_requested,
            accumulated_usage=ModelUsage(
                input_tokens=run_row.input_tokens,
                output_tokens=run_row.output_tokens,
                cache_read_tokens=run_row.cache_read_tokens,
                cache_write_tokens=run_row.cache_write_tokens,
            ),
            terminal_error=terminal_error,
            final_assistant_content=final_content,
            created_at=run_row.created_at,
        )


class DbEventSink:
    def __init__(self, db: Session, run_id: str) -> None:
        self._db = db
        self._run_id = run_id
        self.last_published_sequence: int | None = None
        current_max = db.scalar(
            select(AgentRunEvent.sequence_index)
            .where(AgentRunEvent.run_id == run_id)
            .order_by(AgentRunEvent.sequence_index.desc())
            .limit(1)
        )
        self._sequence = int(current_max if current_max is not None else 0)

    def _next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence

    def publish(self, event: Any) -> None:
        event_type = str(getattr(event, "event_type", ""))
        if not event_type:
            return
        if event_type == "model_delta":
            return
        try:
            orm_type = AgentRunEventType(event_type)
        except ValueError:
            return
        enriched = enrich_harness_event_for_publication(event)
        row = AgentRunEvent(
            run_id=self._run_id,
            sequence_index=self._next_sequence(),
            event_type=orm_type,
            payload_json=enriched.model_dump(exclude={"arguments_json", "output_json"}),
        )
        self._db.add(row)
        self._db.commit()
        self.last_published_sequence = row.sequence_index


def tool_definitions_from_catalog(definitions: list[AgentToolDefinition]) -> list:
    from backend.services.agent.harness.contracts import ToolDefinition

    return [
        ToolDefinition(
            name=definition.name,
            description=definition.description,
            parameters_json_schema=definition.openai_tool_schema["function"]["parameters"],
        )
        for definition in definitions
    ]
