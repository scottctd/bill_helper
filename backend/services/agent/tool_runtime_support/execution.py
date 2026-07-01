# CALLING SPEC:
# - Purpose: execute one registered tool handler with shared retry policy and structured errors.
# - Inputs: tool name, arguments dict, ToolContext with DB session for settings resolution.
# - Outputs: ToolExecutionResult success or error payloads.
# - Side effects: invokes tool handlers; may retry transient failures per retry_policy settings.
from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError

from backend.services.agent.error_policy import report_recoverable_error
from backend.services.agent.retry_policy import build_tool_execution_retrying
from backend.services.agent.tool_results import error_result
from backend.services.agent.tool_runtime_support.catalog import TOOLS
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult
from backend.services.crud_policy import PolicyViolation
from backend.services.runtime_settings import resolve_runtime_settings

logger = logging.getLogger(__name__)
_LEGACY_TOOL_ALIASES = {
    "terminal": "run_bh",
}


def _json_safe_validation_details(exc: ValidationError) -> list[dict[str, Any]]:
    return exc.errors(include_context=False)


def execute_tool(name: str, arguments: dict[str, Any], context: ToolContext) -> ToolExecutionResult:
    definition = TOOLS.get(_LEGACY_TOOL_ALIASES.get(name, name))
    if definition is None:
        return error_result(f"unknown tool '{name}'")

    try:
        parsed = definition.args_model.model_validate(arguments)
    except ValidationError as exc:
        return error_result("invalid tool arguments", details=_json_safe_validation_details(exc))

    settings = resolve_runtime_settings(context.db)
    retrying = build_tool_execution_retrying(
        max_attempts=settings.agent_retry_max_attempts,
        initial_wait_seconds=settings.agent_retry_initial_wait_seconds,
        max_wait_seconds=settings.agent_retry_max_wait_seconds,
        backoff_multiplier=settings.agent_retry_backoff_multiplier,
    )

    try:
        result = None
        for attempt in retrying:
            with attempt:
                result = definition.handler(context, parsed)
        if result is None:  # pragma: no cover - defensive guard
            return error_result("tool execution failed", details="no result returned")
        return result
    except PolicyViolation as exc:
        return error_result("tool execution failed", details=exc.detail)
    except ValueError as exc:
        return error_result("tool execution failed", details=str(exc))
    except Exception as exc:  # pragma: no cover - guarded for runtime resilience
        report_recoverable_error(
            scope="tool_runtime.execute_tool",
            error=exc,
            context={"tool_name": name},
            log=logger,
        )
        logger.exception(
            "tool execution failed unexpectedly",
            extra={"tool_name": name, "error_type": type(exc).__name__},
        )
        return error_result("tool execution failed", details=str(exc))
