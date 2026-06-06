# CALLING SPEC:
# - Purpose: implement focused service logic for `shared`.
# - Inputs: callers that import `backend/services/agent/tool_args/shared.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `shared`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ToolArgsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyArgs(ToolArgsModel):
    pass
