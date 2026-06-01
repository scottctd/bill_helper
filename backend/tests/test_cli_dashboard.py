from __future__ import annotations

import argparse
import json
from typing import Any

import pytest

from backend.cli import main as cli_main
from backend.cli.dashboard_commands import add_dashboard_parser
from backend.cli.rendering import render_output


def _setup_cli_env(monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")
    monkeypatch.setenv("BH_THREAD_ID", "thread-123")


def _get_subparser(parser: argparse.ArgumentParser, *names: str) -> argparse.ArgumentParser:
    action = next(
        action for action in parser._actions if isinstance(action, argparse._SubParsersAction)
    )
    current = parser
    for name in names:
        current = action._name_parser_map[name]
        sub_actions = [
            next_action for next_action in current._actions if isinstance(next_action, argparse._SubParsersAction)
        ]
        action = sub_actions[0] if sub_actions else None
    return current


def test_dashboard_parser_registers_subcommands() -> None:
    parser = argparse.ArgumentParser(prog="bh")
    subparsers = parser.add_subparsers(dest="command")
    add_dashboard_parser(subparsers, lambda p: None)

    finance_get = _get_subparser(parser, "dashboard", "finance", "get")
    assert "--sections" in finance_get.format_help()
    assert "--breakdown-depth" in finance_get.format_help()

    agent_get = _get_subparser(parser, "dashboard", "agent", "get")
    assert "--range" in agent_get.format_help()
    assert "--sections" in agent_get.format_help()


def test_dashboard_finance_get_renders_compact(monkeypatch) -> None:
    payload = {
        "scope": {"mode": "month", "month": "2026-05", "currency_code": "CAD"},
        "kpis": {
            "expense_total_minor": 1000,
            "income_total_minor": 2000,
            "net_total_minor": 1000,
            "average_expense_day_minor": 100,
            "median_expense_day_minor": 90,
            "spending_days": 10,
            "average_day_to_day_minor": 50,
            "median_day_to_day_minor": 40,
        },
        "notes": ["Amounts are integer minor units in the dashboard currency unless rendered as text."],
    }
    rendered = render_output(payload, output_format="compact", render_key="dashboard_finance")
    assert "dashboard kpis" in rendered
    assert "1000|2000|1000" in rendered


def test_dashboard_agent_get_renders_json(monkeypatch) -> None:
    payload = {
        "scope": {"range_key": "30d", "granularity": "day"},
        "metrics": {"total_cost_usd": 1.25, "total_tokens": 100, "total_run_count": 2},
        "notes": ["Costs are USD floats derived from persisted token counters on finished runs."],
    }
    rendered = render_output(payload, output_format="json", render_key="dashboard_agent")
    parsed = json.loads(rendered)
    assert parsed["metrics"]["total_cost_usd"] == 1.25


def test_dashboard_finance_get_calls_api(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)
    calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def fake_request_json(context, method, path, *, params=None, json_body=None, include_run_id=False, error_formatter=None):
        calls.append((method, path, params))
        if path == "/dashboard":
            return 200, {
                "month": params["month"],
                "currency_code": "CAD",
                "kpis": {"expense_total_minor": 500, "income_total_minor": 0, "net_total_minor": -500},
                "filter_groups": [],
                "daily_spending": [],
                "monthly_trend": [],
                "spending_by_from": [],
                "spending_by_to": [],
                "spending_by_tag": [],
                "income_by_from": [],
                "weekday_spending": [],
                "largest_expenses": [],
                "projection": {"is_current_month": False},
                "reconciliation": [],
            }
        raise AssertionError(f"Unexpected path: {path}")

    monkeypatch.setattr("backend.cli.dashboard_commands.request_json", fake_request_json)

    exit_code = cli_main.main(
        ["dashboard", "finance", "get", "--month", "2026-05", "--sections", "kpis", "--format", "json"]
    )
    assert exit_code == 0
    assert calls == [("GET", "/dashboard", {"month": "2026-05"})]


def test_dashboard_finance_get_year_uses_timeline_and_batch(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)
    calls: list[tuple[str, str]] = []

    def fake_request_json(context, method, path, *, params=None, json_body=None, include_run_id=False, error_formatter=None):
        calls.append((method, path))
        if path == "/dashboard/timeline":
            return 200, {"months": ["2026-01", "2026-02"]}
        if path == "/dashboard/batch":
            return 200, {
                "dashboards": [
                    {
                        "month": "2026-01",
                        "currency_code": "CAD",
                        "kpis": {"expense_total_minor": 100, "income_total_minor": 0, "net_total_minor": -100},
                        "filter_groups": [],
                        "daily_spending": [],
                        "monthly_trend": [],
                        "spending_by_from": [],
                        "spending_by_to": [],
                        "spending_by_tag": [],
                        "income_by_from": [],
                        "weekday_spending": [],
                        "largest_expenses": [],
                        "projection": {"is_current_month": False},
                        "reconciliation": [],
                    }
                ]
            }
        raise AssertionError(f"Unexpected path: {path}")

    monkeypatch.setattr("backend.cli.dashboard_commands.request_json", fake_request_json)

    exit_code = cli_main.main(
        ["dashboard", "finance", "get", "--year", "2026", "--sections", "kpis", "--format", "json"]
    )
    assert exit_code == 0
    assert calls == [("GET", "/dashboard/timeline"), ("GET", "/dashboard/batch")]


def test_dashboard_agent_get_calls_api(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)

    def fake_request_json(context, method, path, *, params=None, json_body=None, include_run_id=False, error_formatter=None):
        assert path == "/agent/dashboard"
        assert params == {"range": "7d", "model": ["gpt-4o"], "surface": ["app"]}
        return 200, {
            "range_key": "7d",
            "granularity": "day",
            "available_models": ["gpt-4o"],
            "available_surfaces": ["app"],
            "selected_models": ["gpt-4o"],
            "selected_surfaces": ["app"],
            "metrics": {"total_cost_usd": 0.5, "total_tokens": 10, "total_run_count": 1},
            "cost_series": [],
            "token_distribution": [],
            "model_breakdown": [],
            "surface_breakdown": [],
            "top_runs": [],
        }

    monkeypatch.setattr("backend.cli.dashboard_commands.request_json", fake_request_json)

    exit_code = cli_main.main(
        [
            "dashboard",
            "agent",
            "get",
            "--range",
            "7d",
            "--model",
            "gpt-4o",
            "--surface",
            "app",
            "--sections",
            "metrics",
            "--format",
            "json",
        ]
    )
    assert exit_code == 0
