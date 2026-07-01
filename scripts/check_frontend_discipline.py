#!/usr/bin/env python3
# CALLING SPEC:
# - Purpose: enforce frontend TanStack Query and error-casting discipline via repository greps.
# - Inputs: scans `frontend/src` for invalidateQueries, page-level useQuery, and `as Error` casts.
# - Outputs: pass/fail report listing violations; exit `0` or `1`.
# - Side effects: reads source files only.
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_SRC = ROOT / "frontend" / "src"
INVALIDATION_CANONICAL = FRONTEND_SRC / "lib" / "queryInvalidation.ts"
PAGES_DIR = FRONTEND_SRC / "pages"

# Legitimate AbortError guards; allowlist may only shrink.
AS_ERROR_ALLOWLIST = frozenset(
    {
        "frontend/src/features/agent/panel/useAgentAttachmentObjectUrl.ts",
        "frontend/src/features/agent/panel/useAgentComposerActions.ts",
        "frontend/src/features/agent/panel/useAgentStreamReconnect.ts",
        "frontend/src/hooks/useEntryTagSuggestion.ts",
    }
)

SKIP_DIR_PARTS = {"node_modules", "dist", "build"}


@dataclass(frozen=True, slots=True)
class Violation:
    relative_path: str
    line_number: int
    message: str


def _iter_source_files() -> list[Path]:
    files: list[Path] = []
    for path in FRONTEND_SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        if any(part in SKIP_DIR_PARTS for part in path.parts):
            continue
        files.append(path)
    return sorted(files)


def _scan_invalidate_queries(path: Path) -> list[Violation]:
    if path.resolve() == INVALIDATION_CANONICAL.resolve():
        return []
    violations: list[Violation] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if "invalidateQueries" in line:
            violations.append(
                Violation(
                    path.relative_to(ROOT).as_posix(),
                    line_number,
                    "invalidateQueries must live in frontend/src/lib/queryInvalidation.ts",
                )
            )
    return violations


def _scan_page_use_query(path: Path) -> list[Violation]:
    if PAGES_DIR not in path.parents and path != PAGES_DIR:
        return []
    violations: list[Violation] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if re.search(r"\buseQuery\s*\(", line):
            violations.append(
                Violation(
                    path.relative_to(ROOT).as_posix(),
                    line_number,
                    "useQuery( is forbidden under frontend/src/pages/; use a page model hook",
                )
            )
    return violations


def _scan_as_error_casts(path: Path) -> list[Violation]:
    relative = path.relative_to(ROOT).as_posix()
    if relative in AS_ERROR_ALLOWLIST:
        return []
    violations: list[Violation] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if re.search(r"\bas Error\b", line):
            violations.append(
                Violation(
                    relative,
                    line_number,
                    "`as Error` cast is forbidden outside the explicit allowlist",
                )
            )
    return violations


def main() -> int:
    violations: list[Violation] = []
    for path in _iter_source_files():
        violations.extend(_scan_invalidate_queries(path))
        violations.extend(_scan_page_use_query(path))
        violations.extend(_scan_as_error_casts(path))

    if violations:
        print("Frontend discipline check FAILED:")
        for violation in violations:
            print(f"- {violation.relative_path}:{violation.line_number}: {violation.message}")
        return 1

    print("Frontend discipline check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
