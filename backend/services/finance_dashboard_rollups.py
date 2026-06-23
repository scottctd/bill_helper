# CALLING SPEC:
# - Purpose: build deterministic dashboard expense rollups and presentation summaries.
# - Inputs: scoped expense entries, category paths, filter groups, date windows, and totals.
# - Outputs: category, lifecycle, filter-group, KPI, projection, and breakdown read models.
# - Side effects: none.
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median

from backend.enums_finance import EntryLifecycle
from backend.models_finance import Entry, Group
from backend.schemas_finance import (
    DashboardBreakdownEntryItem,
    DashboardBreakdownItem,
    DashboardCategoryChildSummary,
    DashboardCategorySummary,
    DashboardDailySpendingPoint,
    DashboardGroupSummary,
    DashboardKpisRead,
    DashboardLargestExpenseItem,
    DashboardLifecycleSummary,
    DashboardProjectionRead,
    DashboardToBreakdownItem,
    DashboardWeekdaySpendingPoint,
)
from backend.services.group_membership import effective_entry_ids_for_group
from backend.services.group_rule_context import build_entry_rule_context

DASHBOARD_CATEGORY_TO_BREAKDOWN_LIMIT = 100
UNCATEGORIZED_LABEL = "Uncategorized"
LIFECYCLE_NULL_KEY = "none"
LIFECYCLE_ORDER = (
    EntryLifecycle.FIXED.value,
    EntryLifecycle.DAY_TO_DAY.value,
    EntryLifecycle.ONE_TIME.value,
    LIFECYCLE_NULL_KEY,
)
WEEKDAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


@dataclass(slots=True)
class ExpenseAnalyticsRollup:
    expense_totals_by_date: dict[date, int]
    category_totals_by_date: dict[date, dict[str, int]]
    category_totals: dict[str, int]
    category_entry_counts: dict[str, int]
    path_totals: dict[str, int]
    path_entry_counts: dict[str, int]
    path_to_totals: dict[str, dict[str, int]]
    path_to_entries: dict[str, dict[str, list[DashboardBreakdownEntryItem]]]
    lifecycle_totals: dict[str, int]
    lifecycle_entry_counts: dict[str, int]
    group_totals: dict[str, int]
    group_entry_counts: dict[str, int]
    spending_by_from: dict[str, int]
    spending_by_to: dict[str, int]
    spending_by_tag: dict[str, int]
    weekday_totals: dict[int, int]
    largest_expenses: list[DashboardLargestExpenseItem]


def normalize_breakdown_label(raw_label: str | None) -> str:
    normalized = (raw_label or "").strip()
    return normalized if normalized else "(unspecified)"


def category_path_key(path: str | None) -> str:
    return path if path is not None else UNCATEGORIZED_LABEL


def category_top(path_key: str) -> str:
    return path_key.split("/", 1)[0]


def category_child_name(path_key: str) -> str:
    return path_key.split("/", 1)[1] if "/" in path_key else path_key


def lifecycle_key(entry: Entry) -> str:
    return entry.lifecycle.value if entry.lifecycle is not None else LIFECYCLE_NULL_KEY


def build_breakdown_items(
    totals: dict[str, int],
    limit: int = 8,
) -> list[DashboardBreakdownItem]:
    grand_total = sum(totals.values())
    if grand_total <= 0:
        return []
    rows = sorted(totals.items(), key=lambda row: (-row[1], row[0]))[:limit]
    return [
        DashboardBreakdownItem(
            label=label,
            total_minor=total_minor,
            share=round(total_minor / grand_total, 4),
        )
        for label, total_minor in rows
    ]


def rollup_expense_entries(
    expense_entries: list[Entry],
    *,
    category_paths: dict[str, str],
    groups: list[Group],
    account_entity_ids: set[str],
) -> ExpenseAnalyticsRollup:
    expense_totals_by_date: dict[date, int] = defaultdict(int)
    category_totals_by_date: dict[date, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    category_totals: dict[str, int] = defaultdict(int)
    category_entry_counts: dict[str, int] = defaultdict(int)
    path_totals: dict[str, int] = defaultdict(int)
    path_entry_counts: dict[str, int] = defaultdict(int)
    path_to_totals: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    path_to_entries: dict[
        str, dict[str, list[DashboardBreakdownEntryItem]]
    ] = defaultdict(lambda: defaultdict(list))
    lifecycle_totals: dict[str, int] = defaultdict(int)
    lifecycle_entry_counts: dict[str, int] = defaultdict(int)
    group_totals: dict[str, int] = defaultdict(int)
    group_entry_counts: dict[str, int] = defaultdict(int)
    spending_by_from: dict[str, int] = defaultdict(int)
    spending_by_to: dict[str, int] = defaultdict(int)
    spending_by_tag: dict[str, int] = defaultdict(int)
    weekday_totals: dict[int, int] = defaultdict(int)
    largest_expenses: list[DashboardLargestExpenseItem] = []

    contexts = {
        entry.id: build_entry_rule_context(
            entry,
            category_path=category_paths.get(entry.id),
            account_entity_ids=account_entity_ids,
        )
        for entry in expense_entries
    }
    membership_by_group = {
        group.id: effective_entry_ids_for_group(
            group,
            entries=expense_entries,
            contexts=contexts,
        )
        for group in groups
    }

    for entry in expense_entries:
        amount_minor = entry.amount_minor
        expense_totals_by_date[entry.occurred_at] += amount_minor
        path_key = category_path_key(category_paths.get(entry.id))
        top = category_top(path_key)
        category_totals_by_date[entry.occurred_at][top] += amount_minor
        category_totals[top] += amount_minor
        category_entry_counts[top] += 1
        path_totals[path_key] += amount_minor
        path_entry_counts[path_key] += 1

        to_label = normalize_breakdown_label(entry.to_entity)
        path_to_totals[path_key][to_label] += amount_minor
        path_to_entries[path_key][to_label].append(
            DashboardBreakdownEntryItem(
                id=entry.id,
                occurred_at=entry.occurred_at,
                name=entry.name,
                amount_minor=amount_minor,
            )
        )

        lifecycle_value = entry.lifecycle.value if entry.lifecycle is not None else None
        resolved_lifecycle_key = lifecycle_value or LIFECYCLE_NULL_KEY
        lifecycle_totals[resolved_lifecycle_key] += amount_minor
        lifecycle_entry_counts[resolved_lifecycle_key] += 1

        for group in groups:
            if entry.id not in membership_by_group.get(group.id, set()):
                continue
            group_totals[group.id] += amount_minor
            group_entry_counts[group.id] += 1

        spending_by_from[normalize_breakdown_label(entry.from_entity)] += amount_minor
        spending_by_to[to_label] += amount_minor
        weekday_totals[entry.occurred_at.weekday()] += amount_minor
        normalized_tags = [
            tag.name.strip().lower()
            for tag in entry.tags
            if tag.name and tag.name.strip()
        ]
        for normalized_tag in normalized_tags:
            spending_by_tag[normalized_tag] += amount_minor
        if not normalized_tags:
            spending_by_tag["(untagged)"] += amount_minor

        largest_expenses.append(
            DashboardLargestExpenseItem(
                id=entry.id,
                occurred_at=entry.occurred_at,
                name=entry.name,
                to_entity=entry.to_entity,
                amount_minor=amount_minor,
                category=category_paths.get(entry.id),
                lifecycle=lifecycle_value,
            )
        )

    return ExpenseAnalyticsRollup(
        expense_totals_by_date=expense_totals_by_date,
        category_totals_by_date=category_totals_by_date,
        category_totals=category_totals,
        category_entry_counts=category_entry_counts,
        path_totals=path_totals,
        path_entry_counts=path_entry_counts,
        path_to_totals=path_to_totals,
        path_to_entries=path_to_entries,
        lifecycle_totals=lifecycle_totals,
        lifecycle_entry_counts=lifecycle_entry_counts,
        group_totals=group_totals,
        group_entry_counts=group_entry_counts,
        spending_by_from=spending_by_from,
        spending_by_to=spending_by_to,
        spending_by_tag=spending_by_tag,
        weekday_totals=weekday_totals,
        largest_expenses=largest_expenses,
    )


def _build_to_breakdown(
    to_totals: dict[str, int],
    to_entries: dict[str, list[DashboardBreakdownEntryItem]],
) -> list[DashboardToBreakdownItem]:
    grand_total = sum(to_totals.values())
    if grand_total <= 0:
        return []
    ranked = sorted(to_totals.items(), key=lambda item: (-item[1], item[0]))[
        :DASHBOARD_CATEGORY_TO_BREAKDOWN_LIMIT
    ]
    return [
        DashboardToBreakdownItem(
            label=label,
            total_minor=total_minor,
            share=round(total_minor / grand_total, 4),
            entries=sorted(
                to_entries.get(label, []),
                key=lambda entry: (entry.occurred_at, entry.name),
                reverse=True,
            ),
        )
        for label, total_minor in ranked
    ]


def build_category_summaries(
    rollup: ExpenseAnalyticsRollup,
    *,
    expense_total_minor: int,
) -> list[DashboardCategorySummary]:
    paths_by_top: dict[str, list[str]] = defaultdict(list)
    for path_key in rollup.path_totals:
        paths_by_top[category_top(path_key)].append(path_key)

    summaries: list[DashboardCategorySummary] = []
    for top, paths in paths_by_top.items():
        top_total = rollup.category_totals.get(top, 0)
        if top == UNCATEGORIZED_LABEL:
            children: list[DashboardCategoryChildSummary] = []
            to_breakdown = _build_to_breakdown(
                rollup.path_to_totals.get(top, {}),
                rollup.path_to_entries.get(top, {}),
            )
        else:
            children = [
                DashboardCategoryChildSummary(
                    name=category_child_name(path_key),
                    path=path_key,
                    total_minor=rollup.path_totals[path_key],
                    share=round(rollup.path_totals[path_key] / top_total, 4)
                    if top_total > 0
                    else 0.0,
                    entry_count=rollup.path_entry_counts.get(path_key, 0),
                    to_breakdown=_build_to_breakdown(
                        rollup.path_to_totals.get(path_key, {}),
                        rollup.path_to_entries.get(path_key, {}),
                    ),
                )
                for path_key in sorted(
                    paths,
                    key=lambda candidate: (
                        -rollup.path_totals[candidate],
                        candidate,
                    ),
                )
            ]
            to_breakdown = []
        summaries.append(
            DashboardCategorySummary(
                name=top,
                total_minor=top_total,
                share=round(top_total / expense_total_minor, 4)
                if expense_total_minor > 0
                else 0.0,
                entry_count=rollup.category_entry_counts.get(top, 0),
                children=children,
                to_breakdown=to_breakdown,
            )
        )
    summaries.sort(
        key=lambda summary: (
            summary.name == UNCATEGORIZED_LABEL,
            -summary.total_minor,
            summary.name,
        )
    )
    return summaries


def build_lifecycle_summaries(
    rollup: ExpenseAnalyticsRollup,
    *,
    expense_total_minor: int,
) -> list[DashboardLifecycleSummary]:
    return [
        DashboardLifecycleSummary(
            lifecycle=None if key == LIFECYCLE_NULL_KEY else key,
            total_minor=rollup.lifecycle_totals[key],
            share=round(rollup.lifecycle_totals[key] / expense_total_minor, 4)
            if expense_total_minor > 0
            else 0.0,
            entry_count=rollup.lifecycle_entry_counts.get(key, 0),
        )
        for key in LIFECYCLE_ORDER
        if rollup.lifecycle_totals.get(key, 0) > 0
    ]


def build_group_summaries(
    rollup: ExpenseAnalyticsRollup,
    groups: list[Group],
    *,
    expense_total_minor: int,
) -> list[DashboardGroupSummary]:
    return [
        DashboardGroupSummary(
            group_id=group.id,
            name=group.name,
            source=group.source,
            color=group.color,
            total_minor=rollup.group_totals.get(group.id, 0),
            share=round(
                rollup.group_totals.get(group.id, 0) / expense_total_minor,
                4,
            )
            if expense_total_minor > 0
            else 0.0,
            entry_count=rollup.group_entry_counts.get(group.id, 0),
        )
        for group in groups
    ]


def build_dashboard_kpis(
    *,
    rollup: ExpenseAnalyticsRollup,
    income_total_minor: int,
    cash_withdrawal_total_minor: int,
    expense_total_minor: int,
) -> DashboardKpisRead:
    expense_days = list(rollup.expense_totals_by_date.values())
    one_time_total = rollup.lifecycle_totals.get(EntryLifecycle.ONE_TIME.value, 0)
    return DashboardKpisRead(
        expense_total_minor=expense_total_minor,
        income_total_minor=income_total_minor,
        net_total_minor=income_total_minor - expense_total_minor,
        cash_withdrawal_total_minor=cash_withdrawal_total_minor,
        average_expense_day_minor=int(round(sum(expense_days) / len(expense_days)))
        if expense_days
        else 0,
        median_expense_day_minor=int(round(median(expense_days)))
        if expense_days
        else 0,
        spending_days=len(expense_days),
        one_time_total_minor=one_time_total,
        core_spend_minor=expense_total_minor - one_time_total,
        uncategorized_total_minor=rollup.category_totals.get(
            UNCATEGORIZED_LABEL,
            0,
        ),
    )


def ordered_category_tops(rollup: ExpenseAnalyticsRollup) -> list[str]:
    return sorted(
        rollup.category_totals,
        key=lambda top: (
            top == UNCATEGORIZED_LABEL,
            -rollup.category_totals[top],
            top,
        ),
    )


def build_daily_spending_points(
    *,
    start: date,
    end: date,
    rollup: ExpenseAnalyticsRollup,
    category_tops: list[str],
) -> list[DashboardDailySpendingPoint]:
    points: list[DashboardDailySpendingPoint] = []
    cursor = start
    while cursor < end:
        day_totals = rollup.category_totals_by_date.get(cursor, {})
        points.append(
            DashboardDailySpendingPoint(
                date=cursor,
                expense_total_minor=rollup.expense_totals_by_date.get(cursor, 0),
                category_totals={
                    top: day_totals.get(top, 0) for top in category_tops
                },
            )
        )
        cursor += timedelta(days=1)
    return points


def build_weekday_spending_points(
    weekday_totals: dict[int, int],
) -> list[DashboardWeekdaySpendingPoint]:
    return [
        DashboardWeekdaySpendingPoint(
            weekday=WEEKDAY_LABELS[index],
            total_minor=weekday_totals.get(index, 0),
        )
        for index in range(len(WEEKDAY_LABELS))
    ]


def build_projection(
    *,
    start: date,
    end: date,
    today: date | None,
    expense_entries: list[Entry],
    expense_total_minor: int,
    category_paths: dict[str, str],
) -> DashboardProjectionRead:
    now = today or date.today()
    is_current_month = now.year == start.year and now.month == start.month
    if not is_current_month:
        return DashboardProjectionRead(
            is_current_month=False,
            days_elapsed=(end - start).days,
            days_remaining=0,
            spent_to_date_minor=expense_total_minor,
            projected_total_minor=None,
            projected_remaining_minor=None,
            projected_category_totals={},
        )

    as_of = min(now, end - timedelta(days=1))
    scoped_entries = [
        entry for entry in expense_entries if entry.occurred_at <= as_of
    ]
    spent_to_date_minor = sum(entry.amount_minor for entry in scoped_entries)
    spent_by_category: dict[str, int] = defaultdict(int)
    for entry in scoped_entries:
        spent_by_category[
            category_top(category_path_key(category_paths.get(entry.id)))
        ] += entry.amount_minor
    days_elapsed = max((as_of - start).days + 1, 0)
    days_remaining = max((end - start).days - days_elapsed, 0)

    def project(amount_minor: int) -> int:
        if days_elapsed == 0:
            return amount_minor
        return int(
            round(amount_minor + (amount_minor / days_elapsed) * days_remaining)
        )

    projected_total = project(spent_to_date_minor)
    return DashboardProjectionRead(
        is_current_month=True,
        days_elapsed=days_elapsed,
        days_remaining=days_remaining,
        spent_to_date_minor=spent_to_date_minor,
        projected_total_minor=projected_total,
        projected_remaining_minor=max(projected_total - spent_to_date_minor, 0),
        projected_category_totals={
            top: project(amount) for top, amount in spent_by_category.items()
        },
    )


def rank_expenses(
    largest_expenses: list[DashboardLargestExpenseItem],
) -> list[DashboardLargestExpenseItem]:
    return sorted(
        largest_expenses,
        key=lambda entry: (
            entry.amount_minor,
            entry.occurred_at.toordinal(),
            entry.name,
        ),
        reverse=True,
    )
