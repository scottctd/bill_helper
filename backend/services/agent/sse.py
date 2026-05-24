# CALLING SPEC:
# - Purpose: format server-sent event frames for agent streaming routes.
# - Inputs: event type label and JSON-serializable payload dict.
# - Outputs: SSE wire-format strings.
# - Side effects: none.
from __future__ import annotations

import json


def format_sse_event(event_type: str, payload: dict[str, object]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"
