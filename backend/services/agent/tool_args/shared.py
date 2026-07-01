# CALLING SPEC:
# - Purpose: Pydantic argument models for agent tools touching `shared`.
# - Inputs: Callers import `backend/services/agent/tool_args/shared` and invoke `ToolArgsModel`, `EmptyArgs`.
# - Outputs: Exports `ToolArgsModel`, `EmptyArgs`.
# - Side effects: Pure validation and schema definitions; no persistence.
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ToolArgsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyArgs(ToolArgsModel):
    pass
