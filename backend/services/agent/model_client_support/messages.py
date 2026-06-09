# CALLING SPEC:
# - Purpose: normalize LLM message payloads before provider completion requests.
# - Inputs: in-memory agent message dicts that may include assistant `reasoning`.
# - Outputs: provider-safe message dicts with reasoning mapped to `reasoning_content`.
# - Side effects: none; returns copies without mutating caller-owned lists.
from __future__ import annotations

from copy import deepcopy
from typing import Any


def normalize_assistant_message_for_completion(message: dict[str, Any]) -> dict[str, Any]:
    if message.get("role") != "assistant":
        return message

    normalized = dict(message)
    reasoning = str(normalized.pop("reasoning", "") or "").strip()
    existing_reasoning_content = str(normalized.get("reasoning_content") or "").strip()

    if reasoning and existing_reasoning_content:
        normalized["reasoning_content"] = f"{existing_reasoning_content}\n\n{reasoning}"
    elif reasoning:
        normalized["reasoning_content"] = reasoning
    elif existing_reasoning_content:
        normalized["reasoning_content"] = existing_reasoning_content
    else:
        normalized.pop("reasoning_content", None)

    return normalized


def sanitize_messages_for_completion(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        normalize_assistant_message_for_completion(deepcopy(message)) for message in messages
    ]
