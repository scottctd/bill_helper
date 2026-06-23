"""Pure helpers for `bh dashboard` scope, section filtering, and drill-down depth.

CALLING SPEC:
    parse_section_names(raw_sections, allowed) -> frozenset[str]
    apply_finance_sections(dashboard, sections) -> dict[str, object]
    apply_category_breakdown_depth(categories, depth) -> list[dict[str, object]]
    apply_agent_sections(payload, sections) -> dict[str, object]
    build_finance_scope(*, mode, month, months, currency_code) -> dict[str, object]
    resolve_year_month_keys(timeline_months, year) -> list[str]
    parse_month_list(raw_months) -> list[str]

Inputs:
    - decoded dashboard API payloads and CLI section/depth selections
Outputs:
    - filtered dashboard read payloads ready for rendering
Side effects:
    - none
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from backend.cli.support import CliError

_MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")
_YEAR_PATTERN = re.compile(r"^\d{4}$")

FINANCE_SECTIONS: frozenset[str] = frozenset(
    {
        "meta",
        "kpis",
        "categories",
        "lifecycles",
        "groups",
        "daily_spending",
        "monthly_trend",
        "spending_by_from",
        "spending_by_to",
        "spending_by_tag",
        "income_by_from",
        "weekday_spending",
        "largest_expenses",
        "projection",
        "reconciliation",
        "all",
    }
)

AGENT_SECTIONS: frozenset[str] = frozenset(
    {
        "meta",
        "metrics",
        "cost_series",
        "token_distribution",
        "model_breakdown",
        "surface_breakdown",
        "top_runs",
        "all",
    }
)

BREAKDOWN_DEPTHS: frozenset[str] = frozenset({"summary", "categories", "destinations", "entries"})

_FINANCE_SECTION_FIELDS: dict[str, tuple[str, ...]] = {
    "kpis": ("kpis",),
    "categories": ("categories",),
    "lifecycles": ("lifecycles",),
    "groups": ("groups",),
    "daily_spending": ("daily_spending",),
    "monthly_trend": ("monthly_trend",),
    "spending_by_from": ("spending_by_from",),
    "spending_by_to": ("spending_by_to",),
    "spending_by_tag": ("spending_by_tag",),
    "income_by_from": ("income_by_from",),
    "weekday_spending": ("weekday_spending",),
    "largest_expenses": ("largest_expenses",),
    "projection": ("projection",),
    "reconciliation": ("reconciliation",),
}


def current_month_key(*, today: date | None = None) -> str:
    active_day = today or date.today()
    return active_day.strftime("%Y-%m")


def validate_month_key(month: str) -> str:
    candidate = month.strip()
    if not _MONTH_PATTERN.fullmatch(candidate):
        raise CliError("month must be in YYYY-MM format.")
    return candidate


def validate_year_key(year: str) -> str:
    candidate = year.strip()
    if not _YEAR_PATTERN.fullmatch(candidate):
        raise CliError("year must be a four-digit YYYY value.")
    return candidate


def parse_month_list(raw_months: str) -> list[str]:
    tokens = [token.strip() for token in raw_months.split(",") if token.strip()]
    if not tokens:
        raise CliError("--months must include at least one YYYY-MM value.")
    return [validate_month_key(token) for token in tokens]


def parse_section_names(
    raw_sections: list[str] | None,
    *,
    allowed: frozenset[str],
) -> frozenset[str]:
    if raw_sections is None:
        return frozenset(section for section in allowed if section != "all")
    normalized: set[str] = set()
    for raw_value in raw_sections:
        for token in raw_value.split(","):
            candidate = token.strip().lower()
            if not candidate:
                continue
            normalized.add(candidate)
    if not normalized:
        return frozenset(section for section in allowed if section != "all")
    if "all" in normalized:
        return frozenset(section for section in allowed if section != "all")
    unknown = sorted(normalized - allowed)
    if unknown:
        allowed_list = ", ".join(sorted(section for section in allowed if section != "all"))
        raise CliError(f"Unknown section(s): {', '.join(unknown)}. Allowed: {allowed_list}, all.")
    return frozenset(normalized)


def resolve_year_month_keys(timeline_months: list[str], year: str) -> list[str]:
    normalized_year = validate_year_key(year)
    matched = [month for month in timeline_months if month.startswith(f"{normalized_year}-")]
    if not matched:
        raise CliError(f"No dashboard activity months found for year {normalized_year}.")
    return matched


def build_finance_scope(
    *,
    mode: str,
    month: str | None,
    months: list[str],
    currency_code: str | None,
) -> dict[str, object]:
    scope: dict[str, object] = {"mode": mode}
    if month is not None:
        scope["month"] = month
    if months:
        scope["months"] = months
    if currency_code is not None:
        scope["currency_code"] = currency_code
    return scope


def apply_category_breakdown_depth(
    categories: list[dict[str, Any]],
    depth: str,
) -> list[dict[str, Any]]:
    """Shape the category breakdown tree to the requested drill-down depth.

    summary     -> top-level totals only (drop children + to_breakdown)
    categories  -> top-level + children totals (drop to_breakdown)
    destinations-> top-level + children with to_breakdown, but drop entries
    entries     -> full tree
    """
    if depth not in BREAKDOWN_DEPTHS:
        raise CliError(
            f"Unknown breakdown depth {depth!r}. Allowed: {', '.join(sorted(BREAKDOWN_DEPTHS))}."
        )

    def _strip_entries(to_items: Any) -> list[dict[str, Any]]:
        if not isinstance(to_items, list):
            return []
        return [
            {key: value for key, value in to_item.items() if key != "entries"}
            for to_item in to_items
            if isinstance(to_item, dict)
        ]

    shaped: list[dict[str, Any]] = []
    for category in categories:
        item = dict(category)
        if depth == "summary":
            item.pop("children", None)
            item.pop("to_breakdown", None)
        elif depth == "categories":
            item["children"] = [
                {**child, "to_breakdown": []}
                for child in item.get("children", [])
                if isinstance(child, dict)
            ]
            item["to_breakdown"] = []
        elif depth == "destinations":
            item["children"] = [
                {**child, "to_breakdown": _strip_entries(child.get("to_breakdown", []))}
                for child in item.get("children", [])
                if isinstance(child, dict)
            ]
            item["to_breakdown"] = _strip_entries(item.get("to_breakdown", []))
        shaped.append(item)
    return shaped


def apply_finance_sections(
    dashboard: dict[str, Any],
    sections: frozenset[str],
    *,
    breakdown_depth: str = "entries",
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for section in sections:
        if section == "meta":
            continue
        for field_name in _FINANCE_SECTION_FIELDS.get(section, ()):
            if field_name in dashboard:
                value = dashboard[field_name]
                if field_name == "categories" and isinstance(value, list):
                    payload[field_name] = apply_category_breakdown_depth(value, breakdown_depth)
                else:
                    payload[field_name] = value
    return payload


def apply_agent_sections(payload: dict[str, Any], sections: frozenset[str]) -> dict[str, Any]:
    field_map = {
        "metrics": ("metrics",),
        "cost_series": ("cost_series",),
        "token_distribution": ("token_distribution",),
        "model_breakdown": ("model_breakdown",),
        "surface_breakdown": ("surface_breakdown",),
        "top_runs": ("top_runs",),
    }
    shaped: dict[str, Any] = {}
    if "meta" in sections:
        shaped["scope"] = {
            "range_key": payload.get("range_key"),
            "granularity": payload.get("granularity"),
            "selected_models": payload.get("selected_models", []),
            "selected_surfaces": payload.get("selected_surfaces", []),
            "available_models": payload.get("available_models", []),
            "available_surfaces": payload.get("available_surfaces", []),
        }
    for section, field_names in field_map.items():
        if section not in sections:
            continue
        for field_name in field_names:
            if field_name in payload:
                shaped[field_name] = payload[field_name]
    return shaped


__all__ = [
    "AGENT_SECTIONS",
    "BREAKDOWN_DEPTHS",
    "FINANCE_SECTIONS",
    "apply_agent_sections",
    "apply_category_breakdown_depth",
    "apply_finance_sections",
    "build_finance_scope",
    "current_month_key",
    "parse_month_list",
    "parse_section_names",
    "resolve_year_month_keys",
    "validate_month_key",
    "validate_year_key",
]
