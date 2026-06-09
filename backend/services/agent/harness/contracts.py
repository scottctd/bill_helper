# CALLING SPEC:
# - Purpose: canonical harness contracts independent of HTTP, ORM, SSE, and LiteLLM.
# - Inputs: Pydantic models with extra=forbid for all request/config types.
# - Outputs: RunRequest, RunState, ModelDecision, PreparedStep, RunResult, HarnessEvent unions.
# - Side effects: none.
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class HarnessModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_name: str
    temperature: float | None = None
    max_output_tokens: int | None = None


class HarnessPrincipal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    user_name: str | None = None


class HarnessApprovalPolicy(StrEnum):
    DEFAULT = "default"
    YOLO = "yolo"


class HarnessRunOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface: str
    channel: str | None = None


class TextContentPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text"] = "text"
    text: str


class ImageUrlContentPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["image_url"] = "image_url"
    image_url: dict[str, str]


ContentPart = Annotated[
    TextContentPart | ImageUrlContentPart,
    Field(discriminator="type"),
]


class SystemMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system"] = "system"
    content: str


class UserMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user"] = "user"
    content: str | list[ContentPart]


class ToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_request_id: str
    tool_name: str
    arguments_json: dict[str, Any]
    arguments_decode_error: str | None = None
    raw_arguments: str | None = None


class AssistantMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["assistant"] = "assistant"
    content: str
    reasoning_text: str | None = None
    tool_requests: list[ToolRequest] = Field(default_factory=list)


class ToolResultMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["tool"] = "tool"
    tool_request_id: str
    tool_name: str
    content: str | list[ContentPart]
    is_error: bool = False


TranscriptMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage


class ToolDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    parameters_json_schema: dict[str, Any]


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    thread_id: str | None = None
    turn_index: int | None = None
    principal: HarnessPrincipal
    initial_transcript: list[TranscriptMessage]
    owned_transcript: list[TranscriptMessage] = Field(default_factory=list)
    model_params: HarnessModelConfig
    tool_catalog: list[ToolDefinition]
    max_steps: int = 20
    approval_policy: HarnessApprovalPolicy = HarnessApprovalPolicy.DEFAULT
    origin: HarnessRunOrigin
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None


class ModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transcript: list[TranscriptMessage]
    tool_definitions: list[ToolDefinition]
    model_params: HarnessModelConfig
    trace_metadata: dict[str, Any] = Field(default_factory=dict)


class ModelDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    reasoning_text: str | None = None
    tool_requests: list[ToolRequest] = Field(default_factory=list)
    usage: ModelUsage = Field(default_factory=ModelUsage)
    provider_model: str | None = None
    finish_reason: str | None = None
    latency_ms: int | None = None


class HarnessRunStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    INTERRUPTED = "interrupted"
    MAX_STEPS = "max_steps"
    FAILED = "failed"


class HarnessTerminalError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    detail: str


class TranscriptMessageRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    sequence_index: int
    message: TranscriptMessage


class ToolCallRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    step_id: str
    call_index: int
    tool_request_id: str
    tool_name: str
    arguments_json: dict[str, Any]
    status: str
    result_content: str | list[ContentPart] | None = None
    output_json: dict[str, Any] | None = None
    error_code: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class StepRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    step_index: int
    assistant_message_id: str
    status: str
    usage: ModelUsage = Field(default_factory=ModelUsage)
    finish_reason: str | None = None
    latency_ms: int | None = None


class RunState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    thread_id: str | None = None
    turn_index: int | None = None
    principal: HarnessPrincipal
    model_params: HarnessModelConfig
    tool_catalog: list[ToolDefinition]
    max_steps: int
    approval_policy: HarnessApprovalPolicy
    origin: HarnessRunOrigin
    metadata: dict[str, Any] = Field(default_factory=dict)
    transcript: list[TranscriptMessageRecord] = Field(default_factory=list)
    steps: list[StepRecord] = Field(default_factory=list)
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    completed_steps: int = 0
    status: HarnessRunStatus = HarnessRunStatus.RUNNING
    stop_requested: bool = False
    accumulated_usage: ModelUsage = Field(default_factory=ModelUsage)
    terminal_error: HarnessTerminalError | None = None
    final_assistant_content: str | None = None
    created_at: datetime | None = None


class PreparedStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: RunState
    assistant: TranscriptMessageRecord
    step: StepRecord
    tool_calls: list[ToolCallRecord]
    events: list[HarnessEvent]
    should_continue: bool


class RunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: HarnessRunStatus
    final_assistant_content: str | None
    transcript: list[TranscriptMessageRecord]
    completed_steps: int
    tool_calls: list[ToolCallRecord]
    accumulated_usage: ModelUsage
    total_latency_ms: int | None = None
    terminal_error: HarnessTerminalError | None = None


class RunStartedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["run_started"] = "run_started"
    run_id: str


class ModelRequestStartedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["model_request_started"] = "model_request_started"
    run_id: str
    step_index: int


class ModelDeltaEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["model_delta"] = "model_delta"
    run_id: str
    step_index: int
    delta_type: Literal["reasoning", "content"]
    text: str


class ModelDecisionCommittedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["model_decision_committed"] = "model_decision_committed"
    run_id: str
    step_index: int
    assistant_message_id: str
    has_tool_requests: bool
    reasoning_text: str | None = None


class ToolStartedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["tool_started"] = "tool_started"
    run_id: str
    step_index: int
    tool_call_id: str
    tool_name: str


class ToolFinishedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["tool_finished"] = "tool_finished"
    run_id: str
    step_index: int
    tool_call_id: str
    tool_name: str
    status: str


class StepCommittedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["step_committed"] = "step_committed"
    run_id: str
    step_index: int


class RunFinishedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["run_finished"] = "run_finished"
    run_id: str
    status: HarnessRunStatus
    final_assistant_content: str | None = None
    terminal_error: HarnessTerminalError | None = None


HarnessEvent = (
    RunStartedEvent
    | ModelRequestStartedEvent
    | ModelDeltaEvent
    | ModelDecisionCommittedEvent
    | ToolStartedEvent
    | ToolFinishedEvent
    | StepCommittedEvent
    | RunFinishedEvent
)
