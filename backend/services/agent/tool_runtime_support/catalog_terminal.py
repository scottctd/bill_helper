# CALLING SPEC:
# - Purpose: define internal `bh` CLI runner tool definitions for the runtime catalog.
# - Inputs: callers that import `catalog_terminal.py`.
# - Outputs: `bh` runner `AgentToolDefinition` records.
# - Side effects: module-local registry construction only.
from __future__ import annotations

from backend.services.agent.tool_args.terminal import RunBhArgs
from backend.services.agent.tool_runtime_support.definitions import AgentToolDefinition
from backend.services.agent.terminal import run_bh


TERMINAL_TOOLS: dict[str, AgentToolDefinition] = {
    "run_bh": AgentToolDefinition(
        name="run_bh",
        description=(
            "Use this tool only for Bill Helper app operations through `bh ...`. "
            "It does not provide a general shell or filesystem workspace. "
            "The hosted prompt already includes the Bill Helper domain rules and hosted CLI reference."
        ),
        args_model=RunBhArgs,
        handler=run_bh,
    ),
}
