# CALLING SPEC:
# - Purpose: agent subsystem enums for harness-first persistence and API contracts.
# - Inputs: callers import enum values for ORM columns and API schemas.
# - Outputs: StrEnum values for runs, transcript roles, tool calls, events, proposals.
# - Side effects: none.
from __future__ import annotations

from enum import StrEnum


class AgentTranscriptRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class AgentRunStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    INTERRUPTED = "interrupted"
    MAX_STEPS = "max_steps"
    FAILED = "failed"


class AgentApprovalPolicy(StrEnum):
    DEFAULT = "default"
    YOLO = "yolo"


class AgentToolCallStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    OK = "ok"
    ERROR = "error"
    CANCELLED = "cancelled"


class AgentStepStatus(StrEnum):
    RUNNING = "running"
    COMMITTED = "committed"
    FAILED = "failed"


class AgentRunEventType(StrEnum):
    RUN_STARTED = "run_started"
    MODEL_REQUEST_STARTED = "model_request_started"
    MODEL_DECISION_COMMITTED = "model_decision_committed"
    TOOL_STARTED = "tool_started"
    TOOL_FINISHED = "tool_finished"
    STEP_COMMITTED = "step_committed"
    RUN_FINISHED = "run_finished"


class AgentChangeType(StrEnum):
    CREATE_ENTRY = "create_entry"
    UPDATE_ENTRY = "update_entry"
    DELETE_ENTRY = "delete_entry"
    CREATE_ACCOUNT = "create_account"
    UPDATE_ACCOUNT = "update_account"
    DELETE_ACCOUNT = "delete_account"
    CREATE_SNAPSHOT = "create_snapshot"
    DELETE_SNAPSHOT = "delete_snapshot"
    CREATE_GROUP = "create_group"
    UPDATE_GROUP = "update_group"
    DELETE_GROUP = "delete_group"
    CREATE_GROUP_MEMBER = "create_group_member"
    DELETE_GROUP_MEMBER = "delete_group_member"
    CREATE_TAG = "create_tag"
    UPDATE_TAG = "update_tag"
    DELETE_TAG = "delete_tag"
    CREATE_ENTITY = "create_entity"
    UPDATE_ENTITY = "update_entity"
    DELETE_ENTITY = "delete_entity"


SUPPORTED_AGENT_CHANGE_TYPES: tuple[AgentChangeType, ...] = tuple(AgentChangeType)


def is_supported_agent_change_type(change_type: AgentChangeType) -> bool:
    return change_type in SUPPORTED_AGENT_CHANGE_TYPES


class AgentChangeStatus(StrEnum):
    PENDING_REVIEW = "PENDING_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    APPLIED = "APPLIED"
    APPLY_FAILED = "APPLY_FAILED"


class AgentReviewActionType(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"
