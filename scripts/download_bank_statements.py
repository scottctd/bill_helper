# CALLING SPEC:
# - Purpose: run headed Chrome with a real profile, wait for manual login, and download bank exports.
# - Inputs: CLI flags for Chrome profile paths, output directory, and a JSON recipe file.
# - Outputs: exit code 0 with downloaded file paths printed on success.
# - Side effects: launches Chrome, navigates the configured bank site, and writes downloads to disk.
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from bank_download.browser import (
    chrome_launch_command,
    connect_cdp_chrome,
    default_chrome_user_data_dir,
    launch_persistent_chrome,
)
from bank_download.models import load_recipe
from bank_download.runner import run_bank_download

REPO_ROOT = SCRIPTS_DIR.parent
DEFAULT_RECIPE = SCRIPTS_DIR / "bank_download" / "recipes" / "template.json"
DEFAULT_OUTPUT_ROOT = Path.home() / ".local" / "share" / "bill_helper" / "bank_downloads"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Open headed Chrome with your real profile, wait for manual login, "
            "then run a JSON recipe to download recent bank exports."
        ),
    )
    parser.add_argument(
        "--recipe",
        type=Path,
        default=DEFAULT_RECIPE,
        help=f"Bank recipe JSON file (default: {DEFAULT_RECIPE.relative_to(REPO_ROOT)}).",
    )
    parser.add_argument(
        "--chrome-user-data-dir",
        type=Path,
        default=default_chrome_user_data_dir(),
        help="Chrome user data directory. On macOS this is usually ~/Library/Application Support/Google/Chrome.",
    )
    parser.add_argument(
        "--chrome-profile-directory",
        default="Default",
        help="Chrome profile directory name inside the user data dir, for example Default or 'Profile 1'.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for downloaded files. Defaults to ~/.local/share/bill_helper/bank_downloads/<timestamp>.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run Chrome headless. The MVP flow expects a headed browser for manual login.",
    )
    parser.add_argument(
        "--cdp-url",
        default=None,
        help=(
            "Attach to an already-running Chrome started with --remote-debugging-port "
            "(recommended for banks that block Playwright-launched login)."
        ),
    )
    parser.add_argument(
        "--skip-login-wait",
        action="store_true",
        help="Skip login detection and run recipe steps immediately (typical with --cdp-url).",
    )
    return parser


def _resolve_output_dir(explicit: Path | None, recipe_name: str) -> Path:
    if explicit is not None:
        return explicit.expanduser().resolve()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return (DEFAULT_OUTPUT_ROOT / f"{recipe_name}-{timestamp}").resolve()


def main() -> int:
    args = _build_parser().parse_args()
    recipe_path = args.recipe.expanduser().resolve()
    recipe = load_recipe(recipe_path)
    output_dir = _resolve_output_dir(args.output_dir, recipe.name)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Bank download automation", flush=True)
    print(f"Recipe: {recipe_path}", flush=True)
    print(f"Start URL: {recipe.start_url}", flush=True)
    print(f"Chrome user data dir: {args.chrome_user_data_dir}", flush=True)
    print(f"Chrome profile directory: {args.chrome_profile_directory}", flush=True)
    print(f"Download directory: {output_dir}", flush=True)
    if args.cdp_url:
        print(f"CDP attach URL: {args.cdp_url}", flush=True)
        print("Using attach mode: log in with normal Chrome first, then run this script.", flush=True)
    else:
        print(
            "Close any regular Chrome windows that are using this profile before continuing.",
            flush=True,
        )
        print(
            "If the bank blocks Playwright login, use record_bank_flow.py and --cdp-url instead.",
            flush=True,
        )

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Playwright is not installed. Run:\n"
            "  uv sync --group dev\n"
            "  uv run playwright install chrome",
            file=sys.stderr,
        )
        return 1

    try:
        with sync_playwright() as playwright:
            if args.cdp_url:
                _, context = connect_cdp_chrome(playwright, cdp_url=args.cdp_url)
            else:
                context = launch_persistent_chrome(
                    playwright,
                    user_data_dir=args.chrome_user_data_dir.expanduser().resolve(),
                    profile_directory=args.chrome_profile_directory,
                    downloads_dir=output_dir,
                    headless=args.headless,
                )
            try:
                saved_paths = run_bank_download(
                    context,
                    recipe,
                    output_dir,
                    skip_login_wait=args.skip_login_wait or bool(args.cdp_url),
                )
            finally:
                if args.cdp_url:
                    print("Detached from Chrome. Your browser window stays open.", flush=True)
                else:
                    context.close()
    except Exception as exc:
        print(f"Bank download failed: {exc}", file=sys.stderr)
        return 1

    if saved_paths:
        print("Downloaded files:", flush=True)
        for path in saved_paths:
            print(f"- {path}", flush=True)
    else:
        print(
            "Login completed and recipe steps finished, but no files were captured via wait_for_download.",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
