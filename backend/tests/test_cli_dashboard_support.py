from __future__ import annotations

import pytest

from backend.cli.dashboard_support import (
    apply_filter_group_breakdown_depth,
    apply_finance_sections,
    parse_section_names,
    resolve_year_month_keys,
    FINANCE_SECTIONS,
)
from backend.cli.support import CliError


def test_parse_section_names_defaults_to_all_finance_sections() -> None:
    sections = parse_section_names(None, allowed=FINANCE_SECTIONS)
    assert "kpis" in sections
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


def test_apply_filter_group_breakdown_depth_strips_entries() -> None:
    groups = [
        {
            "key": "day_to_day",
            "tag_totals": {"groceries": 100},
            "tag_to_breakdowns": [
                {
                    "tag": "groceries",
                    "to_items": [
                        {
                            "label": "Farm Boy",
                            "entries": [{"id": "ent-1", "amount_minor": 100}],
                        }
                    ],
                }
            ],
        }
    ]
    shaped = apply_filter_group_breakdown_depth(groups, "destinations")
    to_items = shaped[0]["tag_to_breakdowns"][0]["to_items"]
    assert "entries" not in to_items[0]


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
