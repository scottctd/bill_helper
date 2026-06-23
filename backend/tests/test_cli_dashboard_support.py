from __future__ import annotations

import pytest

from backend.cli.dashboard_support import (
    apply_category_breakdown_depth,
    apply_finance_sections,
    parse_section_names,
    resolve_year_month_keys,
    FINANCE_SECTIONS,
)
from backend.cli.support import CliError


def test_parse_section_names_defaults_to_all_finance_sections() -> None:
    sections = parse_section_names(None, allowed=FINANCE_SECTIONS)
    assert "kpis" in sections
    assert "categories" in sections
    assert "lifecycles" in sections
    assert "filter_groups" in sections
    assert "all" not in sections


def test_parse_section_names_accepts_comma_separated_values() -> None:
    sections = parse_section_names(["kpis,monthly_trend"], allowed=FINANCE_SECTIONS)
    assert sections == frozenset({"kpis", "monthly_trend"})


def test_parse_section_names_rejects_unknown_section() -> None:
    with pytest.raises(CliError, match="Unknown section"):
        parse_section_names(["kpis,unknown"], allowed=FINANCE_SECTIONS)


def test_resolve_year_month_keys_filters_timeline() -> None:
    assert resolve_year_month_keys(["2025-12", "2026-01", "2026-02", "2027-01"], "2026") == [
        "2026-01",
        "2026-02",
    ]


def test_resolve_year_month_keys_errors_when_empty() -> None:
    with pytest.raises(CliError, match="No dashboard activity months"):
        resolve_year_month_keys(["2025-12"], "2026")


def test_apply_category_breakdown_depth_strips_entries() -> None:
    categories = [
        {
            "name": "housing",
            "total_minor": 1000,
            "children": [
                {
                    "name": "rent",
                    "path": "housing/rent",
                    "to_breakdown": [
                        {
                            "label": "Landlord Co",
                            "entries": [{"id": "ent-1", "amount_minor": 1000}],
                        }
                    ],
                }
            ],
        }
    ]
    shaped = apply_category_breakdown_depth(categories, "destinations")
    to_items = shaped[0]["children"][0]["to_breakdown"]
    assert "entries" not in to_items[0]


def test_apply_category_breakdown_depth_summary_drops_children() -> None:
    categories = [
        {
            "name": "housing",
            "total_minor": 1000,
            "children": [{"name": "rent", "path": "housing/rent", "to_breakdown": []}],
            "to_breakdown": [],
        }
    ]
    shaped = apply_category_breakdown_depth(categories, "summary")
    assert "children" not in shaped[0]
    assert "to_breakdown" not in shaped[0]


def test_apply_finance_sections_keeps_only_requested_fields() -> None:
    dashboard = {
        "month": "2026-05",
        "currency_code": "CAD",
        "kpis": {"expense_total_minor": 100},
        "filter_groups": [],
        "daily_spending": [],
    }
    shaped = apply_finance_sections(dashboard, frozenset({"kpis"}))
    assert shaped == {"kpis": {"expense_total_minor": 100}}
