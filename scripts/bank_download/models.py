# CALLING SPEC:
# - Purpose: load and validate bank download recipe JSON contracts.
# - Inputs: recipe file paths or dict payloads from the CLI runner.
# - Outputs: typed `BankRecipe`, `LoginDetect`, and `RecipeStep` objects.
# - Side effects: filesystem reads when loading recipe files.
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class LoginDetect:
    url_patterns: tuple[str, ...]
    exclude_url_patterns: tuple[str, ...]
    selectors: tuple[str, ...]
    timeout_seconds: int
    message: str


@dataclass(frozen=True, slots=True)
class RecipeStep:
    action: str
    url: str | None = None
    selector: str | None = None
    value: str | None = None
    timeout_seconds: int | None = None
    label: str | None = None


@dataclass(frozen=True, slots=True)
class BankRecipe:
    name: str
    start_url: str
    login: LoginDetect
    steps: tuple[RecipeStep, ...]


def _require_str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Recipe field {key!r} must be a non-empty string.")
    return value.strip()


def _optional_str(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Recipe field {key!r} must be a non-empty string when provided.")
    return value.strip()


def _string_list(payload: dict[str, Any], key: str, *, required: bool) -> tuple[str, ...]:
    value = payload.get(key, [] if not required else None)
    if value is None:
        raise ValueError(f"Recipe field {key!r} is required.")
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ValueError(f"Recipe field {key!r} must be a list of non-empty strings.")
    return tuple(item.strip() for item in value)


def _positive_int(payload: dict[str, Any], key: str, default: int) -> int:
    if key not in payload:
        return default
    value = payload[key]
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"Recipe field {key!r} must be a positive integer.")
    return value


def _parse_login(payload: dict[str, Any]) -> LoginDetect:
    if not isinstance(payload, dict):
        raise ValueError("Recipe field 'login' must be an object.")
    return LoginDetect(
        url_patterns=_string_list(payload, "url_patterns", required=False),
        exclude_url_patterns=_string_list(payload, "exclude_url_patterns", required=False),
        selectors=_string_list(payload, "selectors", required=False),
        timeout_seconds=_positive_int(payload, "timeout_seconds", 600),
        message=_optional_str(payload, "message")
        or "Log in manually in the browser window. Automation resumes once login is detected.",
    )


def _parse_step(payload: dict[str, Any], index: int) -> RecipeStep:
    if not isinstance(payload, dict):
        raise ValueError(f"Recipe step #{index + 1} must be an object.")
    action = _require_str(payload, "action").lower()
    return RecipeStep(
        action=action,
        url=_optional_str(payload, "url"),
        selector=_optional_str(payload, "selector"),
        value=_optional_str(payload, "value"),
        timeout_seconds=_positive_int(payload, "timeout_seconds", 30) if "timeout_seconds" in payload else None,
        label=_optional_str(payload, "label"),
    )


def parse_recipe(payload: dict[str, Any]) -> BankRecipe:
    if not isinstance(payload, dict):
        raise ValueError("Recipe payload must be a JSON object.")
    steps_payload = payload.get("steps", [])
    if not isinstance(steps_payload, list):
        raise ValueError("Recipe field 'steps' must be a list.")
    return BankRecipe(
        name=_require_str(payload, "name"),
        start_url=_require_str(payload, "start_url"),
        login=_parse_login(payload.get("login", {})),
        steps=tuple(_parse_step(step, index) for index, step in enumerate(steps_payload)),
    )


def load_recipe(path: Path) -> BankRecipe:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return parse_recipe(raw)
