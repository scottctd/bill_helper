# CALLING SPEC:
# - Purpose: launch headed Chrome with a persistent profile for bank automation.
# - Inputs: Playwright instance plus resolved browser profile and download directory paths.
# - Outputs: a persistent browser context configured for manual login and file downloads.
# - Side effects: starts Chrome, reads/writes the configured user-data directory.
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import Browser, BrowserContext, Playwright


def default_chrome_user_data_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / "Google" / "Chrome"


def default_cdp_user_data_dir() -> Path:
    """Dedicated Chrome data dir required for remote debugging on recent Chrome builds."""
    return Path.home() / ".local" / "share" / "bill_helper" / "chrome-bank-debug"


def chrome_launch_command(*, user_data_dir: Path, profile_directory: str, port: int = 9222) -> str:
    chrome_app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    return (
        f'"{chrome_app}" '
        f'--remote-debugging-port={port} '
        f'--remote-debugging-address=127.0.0.1 '
        f'--user-data-dir="{user_data_dir}" '
        f'--profile-directory="{profile_directory}"'
    )


def wait_for_cdp_endpoint(cdp_url: str, *, timeout_seconds: int = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    version_url = cdp_url.rstrip("/") + "/json/version"
    last_error = "unknown error"

    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(version_url, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if payload.get("webSocketDebuggerUrl"):
                return
            last_error = f"CDP endpoint responded without webSocketDebuggerUrl: {payload!r}"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = str(exc)
        time.sleep(0.5)

    raise TimeoutError(
        f"Timed out waiting for Chrome CDP at {cdp_url} ({last_error}). "
        "Recent Chrome builds refuse remote debugging on the main ~/Library/.../Chrome profile. "
        "Use the dedicated --user-data-dir from record_bank_flow.py instead."
    )


def connect_cdp_chrome(playwright: Playwright, *, cdp_url: str) -> tuple[Browser, BrowserContext]:
    browser = playwright.chromium.connect_over_cdp(cdp_url)
    if not browser.contexts:
        raise RuntimeError(
            f"No browser contexts found at {cdp_url}. "
            "Launch Chrome with --remote-debugging-port first."
        )
    return browser, browser.contexts[0]


def launch_persistent_chrome(
    playwright: Playwright,
    *,
    user_data_dir: Path,
    profile_directory: str | None,
    downloads_dir: Path,
    headless: bool,
) -> BrowserContext:
    downloads_dir.mkdir(parents=True, exist_ok=True)
    launch_args: list[str] = []
    if profile_directory:
        launch_args.append(f"--profile-directory={profile_directory}")

    return playwright.chromium.launch_persistent_context(
        user_data_dir=str(user_data_dir),
        channel="chrome",
        headless=headless,
        accept_downloads=True,
        downloads_path=str(downloads_dir),
        viewport=None,
        args=launch_args,
    )
