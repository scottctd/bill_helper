"""`bh dashboard` subcommand parsers and handlers.

CALLING SPEC:
    add_dashboard_parser(subparsers, add_format_option) -> None

Inputs:
    - argparse subparsers and the shared `--format` option helper from `backend/cli/main.py`
Outputs:
    - registered dashboard timeline/finance/agent commands and HTTP-backed handlers
Side effects:
    - none at import time; handlers perform authenticated HTTP reads when invoked
"""

from __future__ import annotations

import argparse
from typing import Any

from backend.cli.dashboard_support import (
    AGENT_SECTIONS,
    FINANCE_SECTIONS,
    apply_agent_sections,
    apply_finance_sections,
    build_finance_scope,
    current_month_key,
    parse_month_list,
    parse_section_names,
    resolve_year_month_keys,
    validate_month_key,
    validate_year_key,
)
from backend.cli.support import CliContext, CliError, request_json

_DASHBOARD_ROOT_HELP = """\
Finance and agent-cost dashboard reads backed by the same analytics as the web dashboard.

Subcommands:
  timeline  List calendar months with dashboard activity.
  finance   Personal finance dashboard stats (income, expense, breakdowns).
  agent     Agent usage and cost dashboard stats.

Run `bh dashboard <subcommand> --help` for command-specific guidance.
"""

_TIMELINE_HELP = """\
List ascending YYYY-MM months that have visible expense or cash-withdrawal activity in the dashboard currency.

Use this to discover valid `--month` values or to resolve `--year` batch scopes.
"""

_FINANCE_ROOT_HELP = """\
Personal finance dashboard analytics for one month or a multi-month batch.

Subcommands:
  get  Read dashboard KPIs, breakdowns, trends, projection, and reconciliation.

Run `bh dashboard finance get --help` for scope flags, section filters, and examples.
"""

_FINANCE_GET_HELP = """\
Read finance dashboard analytics for one month or a multi-month batch.

Scope (choose exactly one):
  --month YYYY-MM   Single month. Defaults to the current calendar month.
  --year YYYY       Batch all expense-active months in that year.
  --months LIST     Comma-separated YYYY-MM list (max 24 on the backend).

Section filters:
  Repeat `--sections NAME` or pass comma-separated names. Default: all sections.

  meta, kpis, categories, lifecycles, filter_groups, daily_spending,
  monthly_trend, spending_by_from, spending_by_to, spending_by_tag,
  income_by_from, weekday_spending, largest_expenses, projection,
  reconciliation, all

Category drill-down depth (only affects categories):
  summary       top-level category totals only
  categories    include sub-category totals
  destinations  include sub-category -> destination rows without entry rows
  entries       full tree with nested entry rows (default)

Output:
  Default compact output is section-oriented tables. Use `--format json` for the
  full nested category tree and all numeric fields in raw minor units.

Data boundaries:
  - Uses the runtime dashboard currency; other currencies are excluded.
  - Internal account-to-account transfers are excluded from expense analytics.

Examples:
  bh dashboard finance get --sections kpis
  bh dashboard finance get --month 2026-05 --sections categories --format json
  bh dashboard finance get --year 2026 --sections kpis,monthly_trend
  bh dashboard finance get --months 2026-01,2026-02 --sections kpis,categories
"""

_AGENT_ROOT_HELP = """\
Agent usage and cost dashboard analytics (tokens, model spend, surfaces, top runs).

Subcommands:
  get  Read agent dashboard metrics and breakdown tables.

Run `bh dashboard agent get --help` for range filters, section filters, and examples.
"""

_AGENT_GET_HELP = """\
Read agent usage and cost dashboard analytics.

Filters:
  --range {7d,30d,90d,all}   Rolling window. Default: 30d.
  --model NAME               Repeat to filter by model name.
  --surface NAME             Repeat to filter by surface (for example app or telegram).

Section filters:
  Repeat `--sections NAME` or pass comma-separated names. Default: all sections.

  meta, metrics, cost_series, token_distribution, model_breakdown,
  surface_breakdown, top_runs, all

Output:
  Default compact output summarizes KPI cards and ranked tables. Use `--format json`
  for full time-series buckets and top-run metadata.

Examples:
  bh dashboard agent get --range 30d --sections metrics
  bh dashboard agent get --range 90d --sections model_breakdown,top_runs --format json
  bh dashboard agent get --range all --model gpt-4o --surface app
"""


def add_dashboard_parser(subparsers, add_format_option) -> None:
    parser = subparsers.add_parser(
        "dashboard",
        help="Finance and agent-cost dashboard reads.",
        description=_DASHBOARD_ROOT_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.set_defaults(help_parser=parser)
    dashboard = parser.add_subparsers(dest="dashboard_command")

    timeline_parser = dashboard.add_parser(
        "timeline",
        help="List dashboard activity months.",
        description=_TIMELINE_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_format_option(timeline_parser)
    timeline_parser.set_defaults(handler=_handle_dashboard_timeline, render_key="dashboard_timeline")

    finance_parser = dashboard.add_parser(
        "finance",
        help="Personal finance dashboard reads.",
        description=_FINANCE_ROOT_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    finance_parser.set_defaults(help_parser=finance_parser)
    finance = finance_parser.add_subparsers(dest="finance_command")

    finance_get = finance.add_parser(
        "get",
        help="Read finance dashboard analytics.",
        description=_FINANCE_GET_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_format_option(finance_get)
    scope_group = finance_get.add_mutually_exclusive_group()
    scope_group.add_argument("--month", default=None, help="Single month in YYYY-MM format.")
    scope_group.add_argument("--year", default=None, help="Batch all expense-active months in YYYY.")
    scope_group.add_argument(
        "--months",
        default=None,
        help="Comma-separated YYYY-MM list for batch reads.",
    )
    finance_get.add_argument(
        "--sections",
        action="append",
        default=None,
        metavar="NAME",
        help="Section filter. Repeat or comma-separate. Default: all.",
    )
    finance_get.add_argument(
        "--breakdown-depth",
        choices=("summary", "categories", "destinations", "entries"),
        default="entries",
        help="Category drill-down depth when categories is included.",
    )
    finance_get.set_defaults(handler=_handle_dashboard_finance_get, render_key="dashboard_finance")

    agent_parser = dashboard.add_parser(
        "agent",
        help="Agent cost dashboard reads.",
        description=_AGENT_ROOT_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    agent_parser.set_defaults(help_parser=agent_parser)
    agent = agent_parser.add_subparsers(dest="agent_command")

    agent_get = agent.add_parser(
        "get",
        help="Read agent cost dashboard analytics.",
        description=_AGENT_GET_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_format_option(agent_get)
    agent_get.add_argument(
        "--range",
        dest="range_key",
        choices=("7d", "30d", "90d", "all"),
        default="30d",
        help="Rolling analytics window.",
    )
    agent_get.add_argument(
        "--model",
        action="append",
        default=None,
        help="Filter by model name. Repeat for multiple models.",
    )
    agent_get.add_argument(
        "--surface",
        action="append",
        default=None,
        help="Filter by surface. Repeat for multiple surfaces.",
    )
    agent_get.add_argument(
        "--sections",
        action="append",
        default=None,
        metavar="NAME",
        help="Section filter. Repeat or comma-separate. Default: all.",
    )
    agent_get.set_defaults(handler=_handle_dashboard_agent_get, render_key="dashboard_agent")


def _handle_dashboard_timeline(_args: argparse.Namespace, context: CliContext) -> dict[str, Any]:
    _, payload = request_json(context, "GET", "/dashboard/timeline")
    if not isinstance(payload, dict):
        raise CliError("Unexpected dashboard timeline response.")
    return payload


def _handle_dashboard_finance_get(args: argparse.Namespace, context: CliContext) -> dict[str, Any]:
    sections = parse_section_names(args.sections, allowed=FINANCE_SECTIONS)
    include_meta = "meta" in sections
    content_sections = frozenset(section for section in sections if section != "meta")

    if args.year is not None:
        return _fetch_finance_batch(
            context,
            month_keys=_resolve_batch_months_for_year(context, validate_year_key(args.year)),
            sections=content_sections,
            include_meta=include_meta,
            breakdown_depth=args.breakdown_depth,
            mode="year",
        )
    if args.months is not None:
        return _fetch_finance_batch(
            context,
            month_keys=parse_month_list(args.months),
            sections=content_sections,
            include_meta=include_meta,
            breakdown_depth=args.breakdown_depth,
            mode="batch",
        )

    month = validate_month_key(args.month or current_month_key())
    _, dashboard = request_json(context, "GET", "/dashboard", params={"month": month})
    if not isinstance(dashboard, dict):
        raise CliError("Unexpected dashboard response.")
    shaped = apply_finance_sections(
        dashboard,
        content_sections,
        breakdown_depth=args.breakdown_depth,
    )
    if include_meta:
        shaped = {
            "scope": build_finance_scope(
                mode="month",
                month=month,
                months=[],
                currency_code=dashboard.get("currency_code"),
            ),
            **shaped,
        }
    shaped["notes"] = _finance_notes()
    return shaped


def _handle_dashboard_agent_get(args: argparse.Namespace, context: CliContext) -> dict[str, Any]:
    sections = parse_section_names(args.sections, allowed=AGENT_SECTIONS)
    params: dict[str, Any] = {"range": args.range_key}
    if args.model:
        params["model"] = args.model
    if args.surface:
        params["surface"] = args.surface
    _, payload = request_json(context, "GET", "/agent/dashboard", params=params)
    if not isinstance(payload, dict):
        raise CliError("Unexpected agent dashboard response.")
    shaped = apply_agent_sections(payload, sections)
    shaped["notes"] = _agent_notes()
    return shaped


def _resolve_batch_months_for_year(context: CliContext, year: str) -> list[str]:
    _, timeline_payload = request_json(context, "GET", "/dashboard/timeline")
    if not isinstance(timeline_payload, dict):
        raise CliError("Unexpected dashboard timeline response.")
    timeline_months = timeline_payload.get("months")
    if not isinstance(timeline_months, list):
        raise CliError("Unexpected dashboard timeline response.")
    return resolve_year_month_keys([str(month) for month in timeline_months], year)


def _fetch_finance_batch(
    context: CliContext,
    *,
    month_keys: list[str],
    sections: frozenset[str],
    include_meta: bool,
    breakdown_depth: str,
    mode: str,
) -> dict[str, Any]:
    _, batch_payload = request_json(
        context,
        "GET",
        "/dashboard/batch",
        params={"months": month_keys},
    )
    if not isinstance(batch_payload, dict):
        raise CliError("Unexpected dashboard batch response.")
    dashboards_raw = batch_payload.get("dashboards")
    if not isinstance(dashboards_raw, list):
        raise CliError("Unexpected dashboard batch response.")

    dashboards: list[dict[str, Any]] = []
    currency_code: str | None = None
    for dashboard in dashboards_raw:
        if not isinstance(dashboard, dict):
            continue
        if currency_code is None:
            currency_code = dashboard.get("currency_code")
        dashboards.append(
            apply_finance_sections(dashboard, sections, breakdown_depth=breakdown_depth)
        )

    shaped: dict[str, Any] = {"dashboards": dashboards}
    if include_meta:
        shaped = {
            "scope": build_finance_scope(
                mode=mode,
                month=None,
                months=month_keys,
                currency_code=currency_code,
            ),
            **shaped,
        }
    shaped["notes"] = _finance_notes()
    return shaped


def _finance_notes() -> list[str]:
    return [
        "Amounts are integer minor units in the dashboard currency unless rendered as text.",
        "Internal account-to-account transfers are excluded from expense analytics.",
        "Use --format json when you need the full filter-group drill-down tree.",
    ]


def _agent_notes() -> list[str]:
    return [
        "Costs are USD floats derived from persisted token counters on finished runs.",
        "Use --format json for full cost-series buckets and top-run metadata.",
    ]


__all__ = ["add_dashboard_parser"]
