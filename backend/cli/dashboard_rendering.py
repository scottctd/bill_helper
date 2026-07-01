"""Compact and text renderers for `bh dashboard` output.

CALLING SPEC:
    render_dashboard_timeline_compact(payload) -> str
    render_dashboard_timeline_text(payload) -> str
    render_dashboard_finance_compact(payload) -> str
    render_dashboard_finance_text(payload) -> str
    render_dashboard_agent_compact(payload) -> str
    render_dashboard_agent_text(payload) -> str

Inputs:
    - filtered dashboard CLI payloads
Outputs:
    - compact or text render strings
Side effects:
    - none
"""

from __future__ import annotations

import json
from typing import Any

from backend.cli.rendering_support import (
    compact_row,
    compact_table,
    detail_block,
    escape_compact,
    text_table,
)


def render_dashboard_timeline_compact(payload: dict[str, Any]) -> str:
    months = payload.get("months")
    rows = [[month] for month in months] if isinstance(months, list) else []
    return compact_table(
        summary=f"returned {len(rows)} dashboard month(s)",
        schema_key="dashboard_timeline",
        rows=rows,
    )


def render_dashboard_timeline_text(payload: dict[str, Any]) -> str:
    months = payload.get("months")
    rows = [[month] for month in months] if isinstance(months, list) else []
    return text_table(title="Dashboard months", headers=["Month"], rows=rows, empty_text="(none)")


def render_dashboard_finance_compact(payload: dict[str, Any]) -> str:
    if "dashboards" in payload:
        lines: list[str] = []
        scope = payload.get("scope")
        if isinstance(scope, dict):
            lines.append(_scope_line(scope))
        dashboards = payload.get("dashboards")
        if isinstance(dashboards, list):
            for dashboard in dashboards:
                if isinstance(dashboard, dict):
                    lines.extend(_render_finance_dashboard_sections_compact(dashboard))
        notes = payload.get("notes")
        if isinstance(notes, list):
            lines.extend(f"note: {note}" for note in notes if isinstance(note, str))
        return "\n".join(line for line in lines if line)
    return "\n".join(_render_finance_dashboard_sections_compact(payload))


def render_dashboard_finance_text(payload: dict[str, Any]) -> str:
    if "dashboards" in payload:
        blocks: list[str] = []
        scope = payload.get("scope")
        if isinstance(scope, dict):
            blocks.append(_scope_text(scope))
        dashboards = payload.get("dashboards")
        if isinstance(dashboards, list):
            for index, dashboard in enumerate(dashboards):
                if isinstance(dashboard, dict):
                    month_label = "-"
                    outer_scope = payload.get("scope")
                    if isinstance(outer_scope, dict):
                        months = outer_scope.get("months")
                        if isinstance(months, list) and index < len(months):
                            month_label = str(months[index])
                    blocks.append(f"## {month_label}")
                    blocks.append(_render_finance_dashboard_sections_text(dashboard))
        return "\n\n".join(block for block in blocks if block)
    return _render_finance_dashboard_sections_text(payload)


def render_dashboard_agent_compact(payload: dict[str, Any]) -> str:
    lines: list[str] = []
    scope = payload.get("scope")
    if isinstance(scope, dict):
        lines.append(
            "scope: "
            + "|".join(
                escape_compact(str(value))
                for value in (
                    scope.get("range_key"),
                    scope.get("granularity"),
                    ",".join(scope.get("selected_models") or []),
                    ",".join(scope.get("selected_surfaces") or []),
                )
            )
        )
    metrics = payload.get("metrics")
    if isinstance(metrics, dict):
        lines.append(
            compact_table(
                summary="agent metrics",
                schema_key="dashboard_agent_metrics",
                rows=[
                    [
                        metrics.get("total_cost_usd"),
                        metrics.get("total_tokens"),
                        metrics.get("total_run_count"),
                        metrics.get("completed_run_count"),
                        metrics.get("failed_run_count"),
                        metrics.get("avg_cost_per_run_usd"),
                        metrics.get("avg_tokens_per_run"),
                        metrics.get("cache_hit_rate"),
                        metrics.get("most_used_model") or "-",
                        metrics.get("failure_rate"),
                    ]
                ],
            )
        )
    cost_series = payload.get("cost_series")
    if isinstance(cost_series, list) and cost_series:
        lines.append(
            compact_table(
                summary=f"returned {len(cost_series)} cost bucket(s)",
                schema_key="dashboard_agent_cost_series",
                rows=[
                    [item.get("bucket_label"), item.get("total_cost_usd"), item.get("run_count")]
                    for item in cost_series
                    if isinstance(item, dict)
                ],
            )
        )
    model_breakdown = payload.get("model_breakdown")
    if isinstance(model_breakdown, list) and model_breakdown:
        lines.append(
            compact_table(
                summary=f"returned {len(model_breakdown)} model row(s)",
                schema_key="dashboard_agent_model",
                rows=[
                    [
                        item.get("model_name"),
                        item.get("run_count"),
                        item.get("input_tokens"),
                        item.get("output_tokens"),
                        item.get("cache_read_tokens"),
                        item.get("total_tokens"),
                        item.get("total_cost_usd"),
                        item.get("avg_cost_per_run_usd"),
                    ]
                    for item in model_breakdown
                    if isinstance(item, dict)
                ],
            )
        )
    top_runs = payload.get("top_runs")
    if isinstance(top_runs, list) and top_runs:
        lines.append(
            compact_table(
                summary=f"returned {len(top_runs)} top run(s)",
                schema_key="dashboard_agent_top_runs",
                rows=[
                    [
                        item.get("run_id"),
                        item.get("thread_id"),
                        item.get("thread_title") or "-",
                        item.get("model_name"),
                        item.get("surface"),
                        item.get("status"),
                        item.get("total_tokens"),
                        item.get("total_cost_usd"),
                    ]
                    for item in top_runs
                    if isinstance(item, dict)
                ],
            )
        )
    token_distribution = payload.get("token_distribution")
    if isinstance(token_distribution, list) and token_distribution:
        lines.append(
            compact_table(
                summary=f"returned {len(token_distribution)} token slice(s)",
                schema_key="dashboard_agent_token_slice",
                rows=[
                    [item.get("label"), item.get("token_count"), item.get("share")]
                    for item in token_distribution
                    if isinstance(item, dict)
                ],
            )
        )
    surface_breakdown = payload.get("surface_breakdown")
    if isinstance(surface_breakdown, list) and surface_breakdown:
        lines.append(
            compact_table(
                summary=f"returned {len(surface_breakdown)} surface row(s)",
                schema_key="dashboard_agent_surface",
                rows=[
                    [
                        item.get("surface"),
                        item.get("run_count"),
                        item.get("total_tokens"),
                        item.get("total_cost_usd"),
                    ]
                    for item in surface_breakdown
                    if isinstance(item, dict)
                ],
            )
        )
    notes = payload.get("notes")
    if isinstance(notes, list):
        lines.extend(f"note: {note}" for note in notes if isinstance(note, str))
    return "\n".join(line for line in lines if line)


def render_dashboard_agent_text(payload: dict[str, Any]) -> str:
    blocks: list[str] = []
    scope = payload.get("scope")
    if isinstance(scope, dict):
        blocks.append(_scope_text(scope))
    metrics = payload.get("metrics")
    if isinstance(metrics, dict):
        blocks.append(
            detail_block(
                "Agent metrics",
                [
                    ("Total cost USD", metrics.get("total_cost_usd")),
                    ("Total tokens", metrics.get("total_tokens")),
                    ("Total runs", metrics.get("total_run_count")),
                    ("Completed runs", metrics.get("completed_run_count")),
                    ("Failed runs", metrics.get("failed_run_count")),
                    ("Avg cost / run USD", metrics.get("avg_cost_per_run_usd")),
                    ("Avg tokens / run", metrics.get("avg_tokens_per_run")),
                    ("Cache hit rate", metrics.get("cache_hit_rate")),
                    ("Most used model", metrics.get("most_used_model") or "-"),
                    ("Failure rate", metrics.get("failure_rate")),
                ],
            )
        )
    blocks.append(_optional_table(payload, "cost_series", ["Bucket", "Cost USD", "Runs"], row_factory=_cost_series_row))
    blocks.append(
        _optional_table(
            payload,
            "token_distribution",
            ["Label", "Tokens", "Share"],
            row_factory=lambda item: [item.get("label"), item.get("token_count"), item.get("share")],
        )
    )
    blocks.append(
        _optional_table(
            payload,
            "model_breakdown",
            ["Model", "Runs", "Input", "Output", "Cache reads", "Total tokens", "Total cost", "Avg cost"],
            row_factory=lambda item: [
                item.get("model_name"),
                item.get("run_count"),
                item.get("input_tokens"),
                item.get("output_tokens"),
                item.get("cache_read_tokens"),
                item.get("total_tokens"),
                item.get("total_cost_usd"),
                item.get("avg_cost_per_run_usd"),
            ],
        )
    )
    blocks.append(
        _optional_table(
            payload,
            "surface_breakdown",
            ["Surface", "Runs", "Tokens", "Cost USD"],
            row_factory=lambda item: [
                item.get("surface"),
                item.get("run_count"),
                item.get("total_tokens"),
                item.get("total_cost_usd"),
            ],
        )
    )
    blocks.append(
        _optional_table(
            payload,
            "top_runs",
            ["Run", "Thread", "Title", "Model", "Surface", "Status", "Tokens", "Cost USD"],
            row_factory=lambda item: [
                item.get("run_id"),
                item.get("thread_id"),
                item.get("thread_title") or "-",
                item.get("model_name"),
                item.get("surface"),
                item.get("status"),
                item.get("total_tokens"),
                item.get("total_cost_usd"),
            ],
        )
    )
    notes = payload.get("notes")
    if isinstance(notes, list) and notes:
        blocks.append("Notes:\n" + "\n".join(f"- {note}" for note in notes if isinstance(note, str)))
    return "\n\n".join(block for block in blocks if block)


def _render_finance_dashboard_sections_compact(payload: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    scope = payload.get("scope")
    if isinstance(scope, dict):
        lines.append(_scope_line(scope))
    kpis = payload.get("kpis")
    if isinstance(kpis, dict):
        lines.append(
            compact_table(
                summary="dashboard kpis",
                schema_key="dashboard_kpis",
                rows=[
                    [
                        kpis.get("expense_total_minor"),
                        kpis.get("income_total_minor"),
                        kpis.get("net_total_minor"),
                        kpis.get("cash_withdrawal_total_minor"),
                        kpis.get("average_expense_day_minor"),
                        kpis.get("median_expense_day_minor"),
                        kpis.get("spending_days"),
                        kpis.get("one_time_total_minor"),
                        kpis.get("core_spend_minor"),
                        kpis.get("uncategorized_total_minor"),
                    ]
                ],
            )
        )
    categories = payload.get("categories")
    if isinstance(categories, list) and categories:
        lines.append(
            compact_table(
                summary=f"returned {len(categories)} category row(s)",
                schema_key="dashboard_categories",
                rows=[
                    [item.get("name"), item.get("total_minor"), item.get("share"), item.get("entry_count")]
                    for item in categories
                    if isinstance(item, dict)
                ],
            )
        )
    lifecycles = payload.get("lifecycles")
    if isinstance(lifecycles, list) and lifecycles:
        lines.append(
            compact_table(
                summary=f"returned {len(lifecycles)} lifecycle row(s)",
                schema_key="dashboard_lifecycles",
                rows=[
                    [item.get("lifecycle"), item.get("total_minor"), item.get("share"), item.get("entry_count")]
                    for item in lifecycles
                    if isinstance(item, dict)
                ],
            )
        )
    groups = payload.get("groups")
    if isinstance(groups, list) and groups:
        lines.append(
            compact_table(
                summary=f"returned {len(groups)} group(s)",
                schema_key="dashboard_groups",
                rows=[
                    [item.get("group_id"), item.get("name"), item.get("source"), item.get("total_minor"), item.get("share")]
                    for item in groups
                    if isinstance(item, dict)
                ],
            )
        )
    for kind in (
        "spending_by_from",
        "spending_by_to",
        "spending_by_tag",
        "income_by_from",
    ):
        items = payload.get(kind)
        if isinstance(items, list) and items:
            lines.append(
                compact_table(
                    summary=f"returned {len(items)} {kind} row(s)",
                    schema_key="dashboard_breakdown",
                    rows=[
                        [kind, item.get("label"), item.get("total_minor"), item.get("share")]
                        for item in items
                        if isinstance(item, dict)
                    ],
                )
            )
    daily_spending = payload.get("daily_spending")
    if isinstance(daily_spending, list) and daily_spending:
        lines.append(
            compact_table(
                summary=f"returned {len(daily_spending)} daily spending row(s)",
                schema_key="dashboard_daily_spending",
                rows=[
                    [
                        item.get("date"),
                        item.get("expense_total_minor"),
                        json.dumps(item.get("category_totals") or {}, sort_keys=True, separators=(",", ":")),
                    ]
                    for item in daily_spending
                    if isinstance(item, dict)
                ],
            )
        )
    monthly_trend = payload.get("monthly_trend")
    if isinstance(monthly_trend, list) and monthly_trend:
        lines.append(
            compact_table(
                summary=f"returned {len(monthly_trend)} monthly trend row(s)",
                schema_key="dashboard_monthly_trend",
                rows=[
                    [
                        item.get("month"),
                        item.get("expense_total_minor"),
                        item.get("income_total_minor"),
                    ]
                    for item in monthly_trend
                    if isinstance(item, dict)
                ],
            )
        )
    weekday_spending = payload.get("weekday_spending")
    if isinstance(weekday_spending, list) and weekday_spending:
        lines.append(
            compact_table(
                summary=f"returned {len(weekday_spending)} weekday row(s)",
                schema_key="dashboard_weekday_spending",
                rows=[
                    [item.get("weekday"), item.get("total_minor")]
                    for item in weekday_spending
                    if isinstance(item, dict)
                ],
            )
        )
    largest_expenses = payload.get("largest_expenses")
    if isinstance(largest_expenses, list) and largest_expenses:
        lines.append(
            compact_table(
                summary=f"returned {len(largest_expenses)} largest expense row(s)",
                schema_key="dashboard_largest_expenses",
                rows=[
                    [
                        item.get("id"),
                        item.get("occurred_at"),
                        item.get("name"),
                        item.get("to_entity") or "-",
                        item.get("amount_minor"),
                        item.get("category") or "-",
                        item.get("lifecycle") or "-",
                    ]
                    for item in largest_expenses
                    if isinstance(item, dict)
                ],
            )
        )
    projection = payload.get("projection")
    if isinstance(projection, dict):
        lines.append(
            compact_table(
                summary="dashboard projection",
                schema_key="dashboard_projection",
                rows=[
                    [
                        projection.get("days_elapsed"),
                        projection.get("days_remaining"),
                        projection.get("spent_to_date_minor"),
                        projection.get("projected_total_minor"),
                        projection.get("projected_remaining_minor"),
                    ]
                ],
            )
        )
    reconciliation = payload.get("reconciliation")
    if isinstance(reconciliation, list) and reconciliation:
        lines.append(
            compact_table(
                summary=f"returned {len(reconciliation)} reconciliation row(s)",
                schema_key="dashboard_reconciliation",
                rows=[
                    [
                        item.get("account_name"),
                        item.get("currency_code"),
                        item.get("latest_snapshot_at") or "-",
                        item.get("current_tracked_change_minor"),
                        item.get("last_closed_delta_minor"),
                        item.get("mismatched_interval_count"),
                        item.get("reconciled_interval_count"),
                    ]
                    for item in reconciliation
                    if isinstance(item, dict)
                ],
            )
        )
    notes = payload.get("notes")
    if isinstance(notes, list):
        lines.extend(f"note: {note}" for note in notes if isinstance(note, str))
    return lines


def _render_finance_dashboard_sections_text(payload: dict[str, Any]) -> str:
    blocks: list[str] = []
    scope = payload.get("scope")
    if isinstance(scope, dict):
        blocks.append(_scope_text(scope))
    kpis = payload.get("kpis")
    if isinstance(kpis, dict):
        blocks.append(
            detail_block(
                "KPIs",
                [
                    ("Expense minor", kpis.get("expense_total_minor")),
                    ("Income minor", kpis.get("income_total_minor")),
                    ("Net minor", kpis.get("net_total_minor")),
                    ("Cash withdrawal minor", kpis.get("cash_withdrawal_total_minor")),
                    ("Average expense day minor", kpis.get("average_expense_day_minor")),
                    ("Median expense day minor", kpis.get("median_expense_day_minor")),
                    ("Spending days", kpis.get("spending_days")),
                    ("One-time minor", kpis.get("one_time_total_minor")),
                    ("Core spend minor", kpis.get("core_spend_minor")),
                    ("Uncategorized minor", kpis.get("uncategorized_total_minor")),
                ],
            )
        )
    blocks.append(
        _optional_table(
            payload,
            "categories",
            ["Category", "Total minor", "Share", "Entries"],
            row_factory=lambda item: [item.get("name"), item.get("total_minor"), item.get("share"), item.get("entry_count")],
            title="Categories",
        )
    )
    blocks.append(
        _optional_table(
            payload,
            "lifecycles",
            ["Lifecycle", "Total minor", "Share", "Entries"],
            row_factory=lambda item: [item.get("lifecycle"), item.get("total_minor"), item.get("share"), item.get("entry_count")],
            title="Lifecycles",
        )
    )
    blocks.append(
        _optional_table(
            payload,
            "groups",
            ["Group", "Name", "Source", "Total minor", "Share"],
            row_factory=lambda item: [
                item.get("group_id"),
                item.get("name"),
                item.get("source"),
                item.get("total_minor"),
                item.get("share"),
            ],
            title="Groups",
        )
    )
    for kind, title in (
        ("spending_by_from", "Spending by from"),
        ("spending_by_to", "Spending by to"),
        ("spending_by_tag", "Spending by tag"),
        ("income_by_from", "Income by from"),
    ):
        blocks.append(
            _optional_table(
                payload,
                kind,
                ["Label", "Total minor", "Share"],
                row_factory=lambda item: [item.get("label"), item.get("total_minor"), item.get("share")],
                title=title,
            )
        )
    notes = payload.get("notes")
    if isinstance(notes, list) and notes:
        blocks.append("Notes:\n" + "\n".join(f"- {note}" for note in notes if isinstance(note, str)))
    return "\n\n".join(block for block in blocks if block)


def _scope_line(scope: dict[str, Any]) -> str:
    mode = scope.get("mode") or "-"
    month = scope.get("month")
    months = scope.get("months")
    currency = scope.get("currency_code") or "-"
    if isinstance(months, list) and months:
        month_part = ",".join(str(item) for item in months)
    else:
        month_part = str(month or "-")
    return f"scope: mode={mode}|months={escape_compact(month_part)}|currency={escape_compact(str(currency))}"


def _scope_text(scope: dict[str, Any]) -> str:
    rows = [("Mode", scope.get("mode"))]
    if scope.get("month") is not None:
        rows.append(("Month", scope.get("month")))
    months = scope.get("months")
    if isinstance(months, list) and months:
        rows.append(("Months", ", ".join(str(item) for item in months)))
    if scope.get("currency_code") is not None:
        rows.append(("Currency", scope.get("currency_code")))
    if scope.get("range_key") is not None:
        rows.append(("Range", scope.get("range_key")))
    if scope.get("granularity") is not None:
        rows.append(("Granularity", scope.get("granularity")))
    selected_models = scope.get("selected_models")
    if isinstance(selected_models, list) and selected_models:
        rows.append(("Selected models", ", ".join(str(item) for item in selected_models)))
    selected_surfaces = scope.get("selected_surfaces")
    if isinstance(selected_surfaces, list) and selected_surfaces:
        rows.append(("Selected surfaces", ", ".join(str(item) for item in selected_surfaces)))
    return detail_block("Scope", rows)


def _optional_table(
    payload: dict[str, Any],
    key: str,
    headers: list[str],
    *,
    row_factory,
    title: str | None = None,
) -> str:
    items = payload.get(key)
    if not isinstance(items, list) or not items:
        return ""
    rows = [row_factory(item) for item in items if isinstance(item, dict)]
    return text_table(title=title or key, headers=headers, rows=rows, empty_text="(none)")


def _cost_series_row(item: dict[str, Any]) -> list[Any]:
    return [item.get("bucket_label"), item.get("total_cost_usd"), item.get("run_count")]


__all__ = [
    "render_dashboard_agent_compact",
    "render_dashboard_agent_text",
    "render_dashboard_finance_compact",
    "render_dashboard_finance_text",
    "render_dashboard_timeline_compact",
    "render_dashboard_timeline_text",
]
