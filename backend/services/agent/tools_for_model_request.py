# CALLING SPEC:
# - Purpose: resolve OpenAI tool schemas attached to agent model requests for thread state.
# - Inputs: callers that import `backend/services/agent/tools_for_model_request.py`.
# - Outputs: `tools_for_agent_model_request`.
# - Side effects: none.
from __future__ import annotations

from typing import Any

from backend.services.agent.tool_runtime import build_openai_tool_schemas

_RENAME_THREAD_TOOL_NAME = "rename_thread"


def tools_for_agent_model_request(*, thread_title: str | None) -> list[dict[str, Any]]:
    """Match `RuntimeRunLoopAdapter._model_request_kwargs` tool payloads (token counting).

    Untitled threads force a rename-only tool surface until a title exists; titled threads
    use the full tool catalog (see `LiteLLMModelClient._base_request` when no `tools` kw).
    """
    if thread_title is not None:
        return build_openai_tool_schemas()
    return build_openai_tool_schemas(tool_names=[_RENAME_THREAD_TOOL_NAME])
