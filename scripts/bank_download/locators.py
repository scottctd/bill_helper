# CALLING SPEC:
# - Purpose: resolve Playwright locators from recipe selector strings.
# - Inputs: an active page plus selector strings from recipe steps.
# - Outputs: Playwright locators for click, fill, and download actions.
# - Side effects: none.
from __future__ import annotations

from playwright.sync_api import Locator, Page


def resolve_locator(page: Page, selector: str) -> Locator:
    if selector.startswith("role:"):
        _, role, name = selector.split(":", 2)
        return page.get_by_role(role, name=name)
    if selector.startswith("text="):
        return page.get_by_text(selector.removeprefix("text="))
    return page.locator(selector)
