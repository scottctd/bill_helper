# CALLING SPEC:
# - Purpose: Agent subsystem helpers for `tool_types`.
# - Inputs: Callers import `backend/services/agent/tool_types` and invoke `ToolExecutionStatus`, `ToolExecutionResult`, `ToolContext`.
# - Outputs: Exports `ToolExecutionStatus`, `ToolExecutionResult`, `ToolContext`.
# - Side effects: May read or write SQLAlchemy sessions and commit domain mutations.
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from sqlalchemy.orm import Session


class ToolExecutionStatus(StrEnum):
    OK = "ok"
    ERROR = "error"


@dataclass(slots=True)
class ToolExecutionResult:
    output_text: str
    output_json: dict[str, Any]
    status: ToolExecutionStatus
    llm_content: str | list[dict[str, Any]] | None = None

    def __post_init__(self) -> None:
        self.status = ToolExecutionStatus(self.status)
        self.output_json = dict(self.output_json)
        self.output_json["status"] = self.status.value


@dataclass(slots=True)
class ToolContext:
    db: Session
    run_id: str
    principal_name: str | None = None
    principal_user_id: str | None = None
    principal_is_admin: bool | None = None
