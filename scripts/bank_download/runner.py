# CALLING SPEC:
# - Purpose: wait for manual bank login and execute post-login download recipe steps.
# - Inputs: an active Playwright page/context plus a validated `BankRecipe`.
# - Outputs: downloaded file paths collected during recipe execution.
# - Side effects: navigates the bank site, clicks UI controls, and writes downloads to disk.
from __future__ import annotations

import re
import time
from pathlib import Path

from playwright.sync_api import BrowserContext, Download, Page, TimeoutError as PlaywrightTimeoutError

from bank_download.locators import resolve_locator
from bank_download.models import BankRecipe, RecipeStep


def _step_label(step: RecipeStep, index: int) -> str:
    return step.label or f"step {index + 1}: {step.action}"


def _url_matches_patterns(url: str, patterns: tuple[str, ...]) -> bool:
    if not patterns:
        return False
    return any(re.search(pattern, url, flags=re.IGNORECASE) for pattern in patterns)


def wait_for_manual_login(page: Page, recipe: BankRecipe) -> None:
    login = recipe.login
    deadline = time.monotonic() + login.timeout_seconds
    print(login.message, flush=True)
    print(
        "Waiting for login "
        f"(timeout={login.timeout_seconds}s, url_patterns={login.url_patterns or 'none'}, "
        f"selectors={login.selectors or 'none'})...",
        flush=True,
    )

    while time.monotonic() < deadline:
        current_url = page.url
        if login.url_patterns and _url_matches_patterns(current_url, login.url_patterns):
            if not _url_matches_patterns(current_url, login.exclude_url_patterns):
                print(f"Login detected via URL: {current_url}", flush=True)
                return

        for selector in login.selectors:
            try:
                if resolve_locator(page, selector).first.is_visible(timeout=500):
                    print(f"Login detected via selector {selector!r} at {current_url}", flush=True)
                    return
            except PlaywrightTimeoutError:
                continue

        page.wait_for_timeout(1000)

    raise TimeoutError(
        "Timed out waiting for manual login. "
        "Adjust login.url_patterns or login.selectors in the recipe, then retry."
    )


def _run_click(page: Page, step: RecipeStep) -> None:
    if not step.selector:
        raise ValueError("click steps require 'selector'.")
    timeout_ms = (step.timeout_seconds or 30) * 1000
    resolve_locator(page, step.selector).first.click(timeout=timeout_ms)


def _run_select_option(page: Page, step: RecipeStep) -> None:
    if not step.selector:
        raise ValueError("select_option steps require 'selector'.")
    if step.value is None:
        raise ValueError("select_option steps require 'value'.")
    timeout_ms = (step.timeout_seconds or 30) * 1000
    resolve_locator(page, step.selector).first.select_option(step.value, timeout=timeout_ms)


def _run_fill(page: Page, step: RecipeStep) -> None:
    if not step.selector:
        raise ValueError("fill steps require 'selector'.")
    if step.value is None:
        raise ValueError("fill steps require 'value'.")
    timeout_ms = (step.timeout_seconds or 30) * 1000
    resolve_locator(page, step.selector).first.fill(step.value, timeout=timeout_ms)


def _run_wait_for_selector(page: Page, step: RecipeStep) -> None:
    if not step.selector:
        raise ValueError("wait_for_selector steps require 'selector'.")
    timeout_ms = (step.timeout_seconds or 30) * 1000
    resolve_locator(page, step.selector).first.wait_for(state="visible", timeout=timeout_ms)


def _save_download(download: Download, downloads_dir: Path) -> Path:
    suggested = download.suggested_filename or "download.bin"
    target = downloads_dir / suggested
    if target.exists():
        stem = target.stem
        suffix = target.suffix
        counter = 2
        while target.exists():
            target = downloads_dir / f"{stem}-{counter}{suffix}"
            counter += 1
    download.save_as(str(target))
    return target


def _run_wait_for_download(page: Page, step: RecipeStep, downloads_dir: Path) -> Path:
    timeout_ms = (step.timeout_seconds or 120) * 1000
    with page.expect_download(timeout=timeout_ms) as download_info:
        if step.selector:
            resolve_locator(page, step.selector).first.click(timeout=timeout_ms)
    saved_path = _save_download(download_info.value, downloads_dir)
    print(f"Saved download to {saved_path}", flush=True)
    return saved_path


def execute_recipe_steps(page: Page, recipe: BankRecipe, downloads_dir: Path) -> list[Path]:
    saved_paths: list[Path] = []
    for index, step in enumerate(recipe.steps):
        label = _step_label(step, index)
        print(f"Running {label}...", flush=True)

        if step.action == "goto":
            if not step.url:
                raise ValueError("goto steps require 'url'.")
            page.goto(step.url, wait_until="domcontentloaded")
            continue

        if step.action == "click":
            _run_click(page, step)
            continue

        if step.action == "select_option":
            _run_select_option(page, step)
            continue

        if step.action == "fill":
            _run_fill(page, step)
            continue

        if step.action == "wait_for_selector":
            _run_wait_for_selector(page, step)
            continue

        if step.action == "wait_for_download":
            saved_paths.append(_run_wait_for_download(page, step, downloads_dir))
            continue

        if step.action == "pause":
            print("Paused for manual inspection. Press Enter in this terminal to continue.", flush=True)
            input()
            continue

        raise ValueError(f"Unsupported recipe action {step.action!r} in {label}.")

    return saved_paths


def run_bank_download(
    context: BrowserContext,
    recipe: BankRecipe,
    downloads_dir: Path,
    *,
    skip_login_wait: bool = False,
) -> list[Path]:
    page = context.pages[0] if context.pages else context.new_page()
    if not skip_login_wait:
        if page.url in {"", "about:blank"}:
            page.goto(recipe.start_url, wait_until="domcontentloaded")
        wait_for_manual_login(page, recipe)
    return execute_recipe_steps(page, recipe, downloads_dir)
