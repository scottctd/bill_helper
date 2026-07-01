#!/usr/bin/env python3
# CALLING SPEC:
# - Purpose: verify `bh` argparse leaf commands match `CommandSpec` entries and the committed prompt snapshot is fresh.
# - Inputs: programmatic argparse tree from `backend/cli/main.py`; `COMMAND_SPECS`; pinned snapshot date from the committed doc.
# - Outputs: pass/fail report listing missing or extra CLI/spec commands and prompt drift; exit `0` or `1`.
# - Side effects: reads source files only; renders prompt snapshot in memory for diffing.
from __future__ import annotations

import argparse
import difflib
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "docs" / "features" / "system_prompt_example.md"
SNAPSHOT_DATE_RE = re.compile(r"on `(\d{4}-\d{2}-\d{2})`")
SNAPSHOT_TIMEZONE = "America/Toronto"
SNAPSHOT_SURFACE = "app"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.cli.main import _build_parser  # noqa: E402
from backend.cli_reference.specs import COMMAND_SPECS  # noqa: E402
from scripts.render_agent_system_prompt_snapshot import (  # noqa: E402
    _build_snapshot_markdown,
    _load_render_inputs,
)


def _normalize_spec_command(command: str) -> str:
    normalized = re.sub(r"\s*\[[^\]]+\]", "", command)
    normalized = re.sub(r"\s*<[^>]+>", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _collect_leaf_commands(parser: argparse.ArgumentParser, *, prefix: str = "bh") -> set[str]:
    leaves: set[str] = set()
    for action in parser._actions:
        if not isinstance(action, argparse._SubParsersAction):
            continue
        for name, subparser in action.choices.items():
            subpath = f"{prefix} {name}"
            if any(isinstance(item, argparse._SubParsersAction) for item in subparser._actions):
                leaves.update(_collect_leaf_commands(subparser, prefix=subpath))
            else:
                leaves.add(subpath)
    return leaves


def _command_spec_paths() -> set[str]:
    return {_normalize_spec_command(spec.command) for spec in COMMAND_SPECS}


def _pinned_snapshot_date() -> date:
    if not SNAPSHOT_PATH.is_file():
        raise RuntimeError(f"Missing committed prompt snapshot: {SNAPSHOT_PATH.relative_to(ROOT)}")
    text = SNAPSHOT_PATH.read_text(encoding="utf-8")
    match = SNAPSHOT_DATE_RE.search(text)
    if match is None:
        raise RuntimeError(
            f"Could not read pinned snapshot date from {SNAPSHOT_PATH.relative_to(ROOT)} "
            "(expected `on `YYYY-MM-DD`` in the header)."
        )
    return date.fromisoformat(match.group(1))


def _render_expected_snapshot(*, pinned_date: date) -> str:
    inputs = _load_render_inputs(
        current_date=pinned_date,
        timezone_name=SNAPSHOT_TIMEZONE,
        response_surface=SNAPSHOT_SURFACE,
    )
    return _build_snapshot_markdown(inputs)


def _check_command_parity(errors: list[str]) -> None:
    argparse_paths = _collect_leaf_commands(_build_parser())
    spec_paths = _command_spec_paths()

    missing_specs = sorted(argparse_paths - spec_paths)
    extra_specs = sorted(spec_paths - argparse_paths)

    if missing_specs:
        errors.append(
            "CLI commands missing from backend/cli_reference/specs.py COMMAND_SPECS:\n"
            + "\n".join(f"  - {path}" for path in missing_specs)
        )
    if extra_specs:
        errors.append(
            "CommandSpec entries with no matching argparse leaf command:\n"
            + "\n".join(f"  - {path}" for path in extra_specs)
        )


def _check_prompt_snapshot(errors: list[str]) -> None:
    pinned_date = _pinned_snapshot_date()
    expected = _render_expected_snapshot(pinned_date=pinned_date)
    actual = SNAPSHOT_PATH.read_text(encoding="utf-8")
    if expected == actual:
        return

    diff_lines = list(
        difflib.unified_diff(
            actual.splitlines(),
            expected.splitlines(),
            fromfile=str(SNAPSHOT_PATH.relative_to(ROOT)),
            tofile=f"{SNAPSHOT_PATH.relative_to(ROOT)} (regenerated)",
            lineterm="",
        )
    )
    preview = "\n".join(diff_lines[:40])
    if len(diff_lines) > 40:
        preview += f"\n... ({len(diff_lines) - 40} more diff lines)"
    errors.append(
        "Committed agent system prompt snapshot is stale.\n"
        f"Regenerate with:\n"
        f"  uv run python scripts/render_agent_system_prompt_snapshot.py "
        f"--date {pinned_date.isoformat()}\n"
        f"{preview}"
    )


def main() -> int:
    errors: list[str] = []
    _check_command_parity(errors)
    _check_prompt_snapshot(errors)

    if errors:
        print("CLI parity check FAILED:")
        for error in errors:
            print(f"\n{error}")
        return 1

    print(
        "CLI parity check passed "
        f"({len(_command_spec_paths())} leaf commands, prompt snapshot fresh for pinned date)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
