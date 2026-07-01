#!/usr/bin/env python3
# CALLING SPEC:
# - Purpose: dump the FastAPI OpenAPI schema to a committed JSON file for frontend type generation.
# - Inputs: optional `--output` path (default `frontend/openapi.json`); `OPENROUTER_API_KEY` env when agent imports require it.
# - Outputs: writes deterministic OpenAPI JSON; prints the output path on success.
# - Side effects: writes one JSON file; builds the app in-process without starting a server or touching the database.
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "frontend" / "openapi.json"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dump the backend OpenAPI schema for frontend codegen.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Output path for openapi.json (default: frontend/openapi.json).",
    )
    return parser.parse_args()


def _ensure_openrouter_key() -> None:
    os.environ.setdefault("OPENROUTER_API_KEY", "test")


def dump_openapi(output: Path) -> Path:
    _ensure_openrouter_key()
    from backend.main import create_app

    app = create_app()
    schema = app.openapi()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return output


def main() -> int:
    args = _parse_args()
    output = args.output if args.output.is_absolute() else ROOT / args.output
    written = dump_openapi(output)
    try:
        print(written.relative_to(ROOT))
    except ValueError:
        print(written)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
