# CALLING SPEC:
# - Purpose: Agent subsystem helpers for `tool_results`.
# - Inputs: Callers import `backend/services/agent/tool_results` and invoke `PreparedToolCall`, `tool_result_llm_message`, `format_lines`, `error_result`.
# - Outputs: Exports `PreparedToolCall`, `tool_result_llm_message`, `format_lines`, `error_result`.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.services.agent.tool_types import ToolExecutionResult, ToolExecutionStatus


@dataclass(slots=True)
class PreparedToolCall:
    tool_call: dict[str, Any]
    tool_name: str
    arguments: dict[str, Any]
    raw_arguments: str | None = None
    decode_error: str | None = None


def tool_result_llm_message(
    prepared_tool_call: PreparedToolCall, result: ToolExecutionResult
) -> dict[str, Any]:
    content = result.llm_content if result.llm_content is not None else result.output_text
    return {
        "role": "tool",
        "tool_call_id": prepared_tool_call.tool_call.get("id"),
        "name": prepared_tool_call.tool_name,
        "content": content,
    }


def format_lines(lines: list[str]) -> str:
    return "\n".join(lines)


def error_result(summary: str, *, details: Any | None = None) -> ToolExecutionResult:
    payload: dict[str, Any] = {"status": "ERROR", "summary": summary}
    lines = ["ERROR", f"summary: {summary}"]
    if details is not None:
        payload["details"] = details
        lines.append(f"details: {details}")
    return ToolExecutionResult(
        output_text=format_lines(lines),
        output_json=payload,
        status=ToolExecutionStatus.ERROR,
    )
