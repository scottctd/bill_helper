# CALLING SPEC:
# - Purpose: canonical transcript <-> provider message conversion at model boundary.
# - Inputs: TranscriptMessage lists and provider assistant response dicts.
# - Outputs: provider message dicts and normalized ModelDecision values.
# - Side effects: none; provider-specific reasoning fields stay at this boundary.
from __future__ import annotations

import json
import uuid
from typing import Any

from backend.services.agent.harness.contracts import (
    AssistantMessage,
    ContentPart,
    ImageUrlContentPart,
    ModelDecision,
    ModelUsage,
    SystemMessage,
    TextContentPart,
    ToolRequest,
    ToolResultMessage,
    TranscriptMessage,
    UserMessage,
)
from backend.services.agent.harness.errors import HarnessProviderError
from backend.services.agent.model_client_support.messages import sanitize_messages_for_completion
from backend.services.agent.protocol_helpers import parse_tool_arguments


def _content_parts_to_provider(parts: list[ContentPart]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for part in parts:
        if isinstance(part, TextContentPart):
            result.append({"type": "text", "text": part.text})
        elif isinstance(part, ImageUrlContentPart):
            result.append({"type": "image_url", "image_url": dict(part.image_url)})
    return result


def canonical_message_to_provider(message: TranscriptMessage) -> dict[str, Any]:
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": message.content}
    if isinstance(message, UserMessage):
        if isinstance(message.content, str):
            return {"role": "user", "content": message.content}
        return {"role": "user", "content": _content_parts_to_provider(message.content)}
    if isinstance(message, AssistantMessage):
        provider: dict[str, Any] = {
            "role": "assistant",
            "content": message.content,
        }
        if message.reasoning_text:
            provider["reasoning"] = message.reasoning_text
        if message.tool_requests:
            provider["tool_calls"] = [
                {
                    "id": request.tool_request_id,
                    "type": "function",
                    "function": {
                        "name": request.tool_name,
                        "arguments": json.dumps(request.arguments_json, separators=(",", ":")),
                    },
                }
                for request in message.tool_requests
            ]
        return provider
    if isinstance(message, ToolResultMessage):
        content = (
            message.content
            if isinstance(message.content, str)
            else json.dumps(_content_parts_to_provider(message.content))
        )
        return {
            "role": "tool",
            "tool_call_id": message.tool_request_id,
            "name": message.tool_name,
            "content": content,
        }
    raise HarnessProviderError(f"unsupported transcript message type: {type(message)}")


def canonical_transcript_to_provider(
    transcript: list[TranscriptMessage],
) -> list[dict[str, Any]]:
    messages = [canonical_message_to_provider(message) for message in transcript]
    return sanitize_messages_for_completion(messages)


def _usage_from_provider(usage: dict[str, Any] | None) -> ModelUsage:
    if not usage:
        return ModelUsage()
    return ModelUsage(
        input_tokens=usage.get("input_tokens"),
        output_tokens=usage.get("output_tokens"),
        cache_read_tokens=usage.get("cache_read_tokens"),
        cache_write_tokens=usage.get("cache_write_tokens"),
    )


def provider_response_to_decision(
    response: dict[str, Any],
    *,
    provider_model: str | None = None,
    latency_ms: int | None = None,
) -> ModelDecision:
    content = str(response.get("content") or "")
    reasoning = str(response.get("reasoning") or response.get("reasoning_content") or "").strip() or None
    tool_requests: list[ToolRequest] = []
    for call in response.get("tool_calls") or []:
        function = call.get("function") or {}
        tool_name = str(function.get("name") or "")
        raw_args = function.get("arguments")
        parsed = parse_tool_arguments(raw_args)
        tool_request_id = str(call.get("id") or uuid.uuid4())
        tool_requests.append(
            ToolRequest(
                tool_request_id=tool_request_id,
                tool_name=tool_name,
                arguments_json=parsed.arguments,
                arguments_decode_error=parsed.decode_error,
                raw_arguments=parsed.raw_arguments,
            )
        )
    return ModelDecision(
        content=content,
        reasoning_text=reasoning,
        tool_requests=tool_requests,
        usage=_usage_from_provider(response.get("usage")),
        provider_model=provider_model,
        finish_reason=response.get("finish_reason"),
        latency_ms=latency_ms,
    )
