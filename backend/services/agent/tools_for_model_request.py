# CALLING SPEC:
# - Purpose: single gate for which native tools and tool_choice a model request exposes.
# - Inputs: thread title (None means untitled rename-only surface until a title exists).
# - Outputs: OpenAI tool schemas plus matching request kwargs for gateway and token counting.
# - Side effects: none.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.services.agent.tool_runtime_support.catalog import build_openai_tool_schemas

_RENAME_THREAD_TOOL_NAME = "rename_thread"


@dataclass(frozen=True, slots=True)
class ModelRequestToolExposure:
    tools: list[dict[str, Any]]
    request_kwargs: dict[str, Any]


def expose_tools_for_model_request(*, thread_title: str | None) -> ModelRequestToolExposure:
    """Decide tool surface and tool_choice for live gateway and token-counter paths."""
    if thread_title is not None:
        tools = build_openai_tool_schemas()
        return ModelRequestToolExposure(tools=tools, request_kwargs={"tools": tools})
    tools = build_openai_tool_schemas(tool_names=[_RENAME_THREAD_TOOL_NAME])
    return ModelRequestToolExposure(
        tools=tools,
        request_kwargs={
            "tools": tools,
            "tool_choice": {
                "type": "function",
                "function": {"name": _RENAME_THREAD_TOOL_NAME},
            },
        },
    )


def tools_for_agent_model_request(*, thread_title: str | None) -> list[dict[str, Any]]:
    """Return tool schemas only (token counting and other schema-only callers)."""
    return expose_tools_for_model_request(thread_title=thread_title).tools
