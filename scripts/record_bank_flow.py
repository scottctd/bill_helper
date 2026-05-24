# CALLING SPEC:
# - Purpose: attach Playwright Inspector to an already-running Chrome session for flow recording.
# - Inputs: CLI flags for the Chrome DevTools Protocol endpoint URL.
# - Outputs: exit code 0 after the user finishes recording in the Playwright Inspector.
# - Side effects: connects to a live Chrome window; does not launch or close the browser process.
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from bank_download.browser import (
    chrome_launch_command,
    connect_cdp_chrome,
    default_cdp_user_data_dir,
    wait_for_cdp_endpoint,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Attach Playwright Inspector to a normal Chrome window started with remote debugging. "
            "Use this after logging into your bank manually so anti-bot checks are avoided."
        ),
    )
    parser.add_argument(
        "--cdp-url",
        default="http://127.0.0.1:9222",
        help="Chrome DevTools Protocol endpoint (default: http://127.0.0.1:9222).",
    )
    parser.add_argument(
        "--show-launch-command",
        action="store_true",
        help="Print the Chrome launch command and exit.",
    )
    parser.add_argument(
        "--chrome-user-data-dir",
        type=Path,
        default=default_cdp_user_data_dir(),
        help=(
            "Dedicated Chrome user data directory for remote debugging. "
            "Do not point this at ~/Library/Application Support/Google/Chrome; recent Chrome builds block CDP there."
        ),
    )
    parser.add_argument(
        "--chrome-profile-directory",
        default="Default",
        help="Chrome profile directory name used in the suggested launch command.",
    )
    parser.add_argument(
        "--debugging-port",
        type=int,
        default=9222,
        help="Remote debugging port used in the suggested launch command.",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    user_data_dir = args.chrome_user_data_dir.expanduser().resolve()
    user_data_dir.mkdir(parents=True, exist_ok=True)
    launch_command = chrome_launch_command(
        user_data_dir=user_data_dir,
        profile_directory=args.chrome_profile_directory,
        port=args.debugging_port,
    )

    if args.show_launch_command:
        print(launch_command)
        return 0

    print("Step 1: Quit regular Chrome completely (Cmd+Q).", flush=True)
    print(
        "Step 2: Launch Chrome with remote debugging on a dedicated data dir "
        "(required by Chrome; your everyday profile path will not expose port 9222):",
        flush=True,
    )
    print(launch_command, flush=True)
    print(
        "Step 3: In that Chrome window, log in to your bank and navigate near the export flow.",
        flush=True,
    )
    print(
        "Step 4: Press Enter here once you are logged in and ready to record.",
        flush=True,
    )
    input()

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
        print(f"Checking CDP endpoint {args.cdp_url} ...", flush=True)
        wait_for_cdp_endpoint(args.cdp_url)
        with sync_playwright() as playwright:
            _, context = connect_cdp_chrome(playwright, cdp_url=args.cdp_url)
            page = context.pages[0] if context.pages else context.new_page()
            print(
                "Playwright Inspector will open. Use Record, perform the export clicks, "
                "then copy the generated Python and paste it into the chat.",
                flush=True,
            )
            page.pause()
    except Exception as exc:
        print(f"Recording attach failed: {exc}", file=sys.stderr)
        print(
            "If Chrome printed "
            "'DevTools remote debugging requires a non-default data directory', "
            "you used the main Chrome profile path. Re-run Step 2 with the command above.",
            file=sys.stderr,
        )
        return 1

    print("Detached from Chrome. Your browser window stays open.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
