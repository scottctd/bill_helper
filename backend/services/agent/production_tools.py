# CALLING SPEC:
# - Purpose: adapt existing tool runtime to harness ToolExecutor contract.
# - Inputs: ToolRequest and ToolExecutionContext with DB session.
# - Outputs: ToolExecutionResult for canonical transcript append.
# - Side effects: tool handlers may create proposals and mutate finance records via review.
from __future__ import annotations

import json
from typing import Any

from backend.enums_agent import AgentApprovalPolicy
from backend.services.agent.harness.contracts import ToolRequest
from backend.services.agent.harness.tools import ToolExecutionContext, ToolExecutionResult
from backend.services.agent.tool_runtime import execute_tool
from backend.services.agent.tool_types import ToolContext, ToolExecutionStatus


def _result_content(result: Any) -> str:
    if hasattr(result, "llm_content") and result.llm_content is not None:
        if isinstance(result.llm_content, str):
            return result.llm_content
        return str(result.llm_content)
    if hasattr(result, "output_text"):
        return str(result.output_text or "")
    return str(result)


class ProductionToolExecutor:
    def execute(
        self,
        request: ToolRequest,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        if context.db is None:
            return ToolExecutionResult(
                content="tool execution requires database session",
                is_error=True,
                error_code="missing_db",
            )
        tool_context = ToolContext(
            db=context.db,
            run_id=context.run_id,
            principal_user_id=context.principal.user_id,
            principal_name=context.principal.user_name,
        )
        result = execute_tool(
            request.tool_name,
            dict(request.arguments_json),
            tool_context,
        )
        is_error = result.status != ToolExecutionStatus.OK
        return ToolExecutionResult(
            content=_result_content(result),
            is_error=is_error,
            error_code="tool_error" if is_error else None,
            output_json=dict(result.output_json),
        )
