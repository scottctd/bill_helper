#!/usr/bin/env python3
# CALLING SPEC:
# - Purpose: verify committed OpenAPI JSON and generated frontend API types match the live backend schema.
# - Inputs: committed `frontend/openapi.json` and `frontend/src/lib/api-types.gen.ts`; `OPENROUTER_API_KEY` when agent imports require it.
# - Outputs: prints pass/fail; exits `0` when artifacts are fresh, `1` with regen instructions on drift.
# - Side effects: writes temporary files under the system temp dir; may invoke `npx openapi-typescript` when available.
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
OPENAPI_PATH = FRONTEND_DIR / "openapi.json"
GENERATED_TYPES_PATH = FRONTEND_DIR / "src" / "lib" / "api-types.gen.ts"
REGEN_HINT = (
    "Regenerate API contracts:\n"
    "  uv run python scripts/dump_openapi.py\n"
    "  cd frontend && npm run gen:api"
)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _diff_text(label: str, expected_path: Path, actual_path: Path) -> str | None:
    expected = _read_text(expected_path)
    actual = _read_text(actual_path)
    if expected == actual:
        return None
    import difflib

    diff = difflib.unified_diff(
        expected.splitlines(),
        actual.splitlines(),
        fromfile=str(expected_path.relative_to(ROOT)),
        tofile=f"{expected_path.relative_to(ROOT)} (regenerated)",
        lineterm="",
    )
    lines = list(diff)
    preview = "\n".join(lines[:40])
    if len(lines) > 40:
        preview += f"\n... ({len(lines) - 40} more diff lines)"
    return f"{label} is out of date.\n{preview}"


def _dump_openapi_to(path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "dump_openapi.py"), "--output", str(path)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "unknown error"
        print(f"dump_openapi.py failed: {stderr}", file=sys.stderr)
        raise SystemExit(1)


def _generate_types_from(openapi_path: Path, output_path: Path) -> bool:
    if shutil.which("npx") is None:
        return False
    result = subprocess.run(
        [
            "npx",
            "openapi-typescript",
            str(openapi_path),
            "-o",
            str(output_path),
        ],
        cwd=FRONTEND_DIR,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "unknown error"
        print(f"openapi-typescript failed: {stderr}", file=sys.stderr)
        raise SystemExit(1)
    return True


def main() -> int:
    errors: list[str] = []

    if not OPENAPI_PATH.is_file():
        errors.append(f"Missing committed OpenAPI file: {OPENAPI_PATH.relative_to(ROOT)}")
    if not GENERATED_TYPES_PATH.is_file():
        errors.append(f"Missing generated types file: {GENERATED_TYPES_PATH.relative_to(ROOT)}")

    with tempfile.TemporaryDirectory(prefix="bill-helper-api-types-") as tmp_dir:
        tmp_root = Path(tmp_dir)
        fresh_openapi = tmp_root / "openapi.json"
        fresh_types = tmp_root / "api-types.gen.ts"

        _dump_openapi_to(fresh_openapi)
        openapi_diff = _diff_text("frontend/openapi.json", OPENAPI_PATH, fresh_openapi) if OPENAPI_PATH.is_file() else None
        if openapi_diff:
            errors.append(openapi_diff)

        generated_types_checked = _generate_types_from(fresh_openapi, fresh_types)
        if generated_types_checked and GENERATED_TYPES_PATH.is_file():
            types_diff = _diff_text("frontend/src/lib/api-types.gen.ts", GENERATED_TYPES_PATH, fresh_types)
            if types_diff:
                errors.append(types_diff)
        elif GENERATED_TYPES_PATH.is_file():
            print(
                "note: npx unavailable; checked frontend/openapi.json only "
                "(run `cd frontend && npm run gen:api` locally to refresh TS types).",
                file=sys.stderr,
            )

    if errors:
        print("API types sync check FAILED:")
        for error in errors:
            print(f"\n{error}")
        print(f"\n{REGEN_HINT}")
        return 1

    checked = "frontend/openapi.json"
    if shutil.which("npx") is not None:
        checked += " and frontend/src/lib/api-types.gen.ts"
    print(f"API types sync check passed ({checked}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
