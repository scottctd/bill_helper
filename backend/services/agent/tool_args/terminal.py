# CALLING SPEC:
# - Purpose: define argument contracts for the internal `bh` CLI runner tool.
# - Inputs: callers that import `terminal.py` and pass CLI-style `bh` fields.
# - Outputs: validated Pydantic models for `bh` command execution.
# - Side effects: module-local validation only.
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.services.agent.payload_normalization import normalize_loose_text


class ToolArgsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RunBhArgs(ToolArgsModel):
    command: str = Field(
        min_length=1,
        description=(
            "Bill Helper CLI command to execute. Must start with `bh`; general shell commands are rejected."
        ),
    )
    cwd: str | None = Field(
        default=None,
        description="Ignored legacy field retained for older tool arguments. `run_bh` executes the local `bh` CLI only.",
    )
    timeout_seconds: int = Field(
        default=120,
        ge=1,
        le=600,
        description="Command timeout in seconds. Defaults to 120. Allowed range: 1 to 600.",
    )

    @field_validator("command")
    @classmethod
    def normalize_command(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("value cannot be empty")
        return value

    @field_validator("cwd")
    @classmethod
    def normalize_cwd(cls, value: str | None) -> str | None:
        return normalize_loose_text(value)


RunTerminalArgs = RunBhArgs
