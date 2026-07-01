# CALLING SPEC:
# - Purpose: shared `bh` command reference data importable by CLI and agent prompts.
# - Inputs: none at package import; callers invoke render or lookup helpers.
# - Outputs: CommandSpec data, compact schemas, and cheat-sheet renderers.
# - Side effects: none.
"""Canonical `bh` command reference shared by CLI output and agent prompt embedding."""

from backend.cli_reference.compact_schemas import compact_schema_for
from backend.cli_reference.render import render_bh_cheat_sheet, render_hosted_agent_bh_cheat_sheet
from backend.cli_reference.specs import CommandSpec, CompactSchema

__all__ = [
    "CommandSpec",
    "CompactSchema",
    "compact_schema_for",
    "render_bh_cheat_sheet",
    "render_hosted_agent_bh_cheat_sheet",
]
