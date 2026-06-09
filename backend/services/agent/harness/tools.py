# CALLING SPEC:
# - Purpose: tool executor contracts and registry helpers for harness transitions.
# - Inputs: ToolRequest, ToolDefinition catalog, ToolExecutionContext.
# - Outputs: ToolExecutionResult with canonical content for transcript append.
# - Side effects: tool handlers may mutate DB through injected context.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from backend.services.agent.harness.contracts import (
    ContentPart,
    HarnessPrincipal,
    ToolDefinition,
    ToolRequest,
)


@dataclass(slots=True)
class ToolExecutionContext:
    principal: HarnessPrincipal
    run_id: str
    thread_id: str | None
    approval_policy: str
    metadata: dict[str, Any]
    db: Any = None


@dataclass(slots=True)
class ToolExecutionResult:
    content: str | list[ContentPart]
    is_error: bool = False
    error_code: str | None = None
    output_json: dict[str, Any] | None = None


class ToolExecutor(Protocol):
    def execute(
        self,
        request: ToolRequest,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult: ...


@dataclass(slots=True)
class RegistryToolExecutor:
    handlers: dict[str, Any]
    definitions: list[ToolDefinition]

    def execute(
        self,
        request: ToolRequest,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        handler = self.handlers.get(request.tool_name)
        if handler is None:
            return ToolExecutionResult(
                content=f"unknown tool '{request.tool_name}'",
                is_error=True,
                error_code="unknown_tool",
            )
        return handler(request, context)


def catalog_tool_names(catalog: list[ToolDefinition]) -> set[str]:
    return {definition.name for definition in catalog}


def validate_tool_requests(
    requests: list[ToolRequest],
    catalog: list[ToolDefinition],
) -> str | None:
    allowed = catalog_tool_names(catalog)
    for request in requests:
        if request.tool_name not in allowed:
            return f"unknown tool '{request.tool_name}'"
    return None
