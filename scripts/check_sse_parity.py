#!/usr/bin/env python3
# CALLING SPEC:
# - Purpose: verify frontend SSE event type literals cover backend `AgentRunEventType` plus wire extras.
# - Inputs: `backend/enums_agent.py` enum values; `frontend/src/lib/types/agent.ts` union literals.
# - Outputs: pass/fail report listing missing or extra event types; exit `0` or `1`.
# - Side effects: reads source files only.
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ENUM_PATH = ROOT / "backend" / "enums_agent.py"
FRONTEND_AGENT_TYPES_PATH = ROOT / "frontend" / "src" / "lib" / "types" / "agent.ts"

# Ephemeral model streaming aliases accepted on the SSE wire but not persisted as AgentRunEventType.
FRONTEND_SSE_EXTRA_EVENT_TYPES = frozenset({"model_delta", "reasoning_delta", "text_delta"})


def _backend_agent_run_event_types() -> set[str]:
    module = ast.parse(BACKEND_ENUM_PATH.read_text(encoding="utf-8"), filename=str(BACKEND_ENUM_PATH))
    for node in module.body:
        if not isinstance(node, ast.ClassDef) or node.name != "AgentRunEventType":
            continue
        values: set[str] = set()
        for item in node.body:
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name) and isinstance(item.value, ast.Constant):
                        if isinstance(item.value.value, str):
                            values.add(item.value.value)
        return values
    raise RuntimeError(f"AgentRunEventType not found in {BACKEND_ENUM_PATH.relative_to(ROOT)}")


def _frontend_known_event_types() -> set[str]:
    text = FRONTEND_AGENT_TYPES_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"export const KNOWN_AGENT_STREAM_EVENT_TYPES = \[(.*?)\] as const",
        text,
        re.DOTALL,
    )
    if match is None:
        raise RuntimeError(
            f"Could not parse KNOWN_AGENT_STREAM_EVENT_TYPES from "
            f"{FRONTEND_AGENT_TYPES_PATH.relative_to(ROOT)}"
        )
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


def main() -> int:
    errors: list[str] = []

    backend_types = _backend_agent_run_event_types()
    frontend_types = _frontend_known_event_types()
    required_types = backend_types | FRONTEND_SSE_EXTRA_EVENT_TYPES

    missing = sorted(required_types - frontend_types)
    extra = sorted(frontend_types - required_types)

    if missing:
        errors.append(
            "Frontend KNOWN_AGENT_STREAM_EVENT_TYPES is missing backend/wire event types:\n"
            + "\n".join(f"  - {event_type}" for event_type in missing)
        )
    if extra:
        errors.append(
            "Frontend KNOWN_AGENT_STREAM_EVENT_TYPES includes unexpected event types:\n"
            + "\n".join(f"  - {event_type}" for event_type in extra)
        )

    if errors:
        print("SSE parity check FAILED:")
        for error in errors:
            print(f"\n{error}")
        return 1

    print(
        "SSE parity check passed "
        f"({len(backend_types)} backend event types + {len(FRONTEND_SSE_EXTRA_EVENT_TYPES)} wire extras)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
