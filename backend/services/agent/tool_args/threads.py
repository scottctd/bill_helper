# CALLING SPEC:
# - Purpose: Pydantic argument models for agent tools touching `threads`.
# - Inputs: Callers import `backend/services/agent/tool_args/threads` and invoke `ToolArgsModel`, `RenameThreadArgs`.
# - Outputs: Exports `ToolArgsModel`, `RenameThreadArgs`.
# - Side effects: Pure validation and schema definitions; no persistence.
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.validation.agent_threads import THREAD_TITLE_MAX_LENGTH, validate_thread_title


class ToolArgsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RenameThreadArgs(ToolArgsModel):
    title: str = Field(
        min_length=1,
        max_length=THREAD_TITLE_MAX_LENGTH,
        description="Short thread title/topic in 1-5 words.",
    )

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return validate_thread_title(value)
