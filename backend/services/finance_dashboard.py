# CALLING SPEC:
# - Purpose: dashboard window queries, expense analytics, and dashboard read-model orchestration.
# - Inputs: SQLAlchemy session, scoped principal filters, month windows, runtime settings, and filter group definitions.
# - Outputs: dashboard read models, dashboard timeline reads, and dashboard analytics payloads.
# - Side effects: reads database state only.

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.elements import ColumnElement

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import EntryKind
from backend.models_finance import Account, Entry
from backend.schemas_finance import (
    DashboardMonthlyTrendPoint,
    DashboardRead,
    DashboardTimelineRead,
)
from backend.services.access_scope import account_owner_filter, entry_owner_filter
from backend.services.filter_groups import (
    FilterGroupDefinition,
    list_filter_group_definitions,
)
from backend.services.finance_dashboard_rollups import (
    build_breakdown_items,
    build_category_summaries,
    build_daily_spending_points,
    build_dashboard_kpis,
    build_filter_group_summaries,
    build_lifecycle_summaries,
    build_projection,
    build_weekday_spending_points,
    category_path_key,
    category_top,
    lifecycle_key,
    normalize_breakdown_label,
    ordered_category_tops,
    rank_expenses,
    rollup_expense_entries,
)
from backend.services.finance_reconciliation import (
    build_dashboard_reconciliation_summary,
    build_reconciliation,
    list_dashboard_reconciliation_accounts,
)
from backend.services.runtime_settings import resolve_runtime_settings
from backend.services.taxonomy import get_entry_category_path_map

DASHBOARD_DEFAULT_CURRENCY_CODE = "CAD"
DASHBOARD_DESTINATION_BREAKDOWN_LIMIT = 20
CASH_WITHDRAWAL_TAG = "cash_withdrawal"
DashboardFilter = ColumnElement[bool]


@dataclass(slots=True)
class _MonthlyTrendBucket:
    expense_total_minor: int = 0
    income_total_minor: int = 0
    category_totals: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    lifecycle_totals: dict[str, int] = field(default_factory=lambda: defaultdict(int))


@dataclass(frozen=True, slots=True)
class DashboardAnalyticsOptions:
    currency_code: str = DASHBOARD_DEFAULT_CURRENCY_CODE
    trend_months: int = 12
    today: date | None = None
    entry_filter: DashboardFilter | None = None
    account_filter: DashboardFilter | None = None


def month_window(month: str) -> tuple[date, date]:
    year, month_num = map(int, month.split("-"))
    start = date(year, month_num, 1)
    if month_num == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month_num + 1, 1)
    return start, end


def build_dashboard_read(
    db: Session,
    *,
    month: str,
    principal: RequestPrincipal,
) -> DashboardRead:
    start, end = month_window(month)

    runtime_settings = resolve_runtime_settings(db)
    dashboard_currency_code = runtime_settings.dashboard_currency_code
    filter_groups = list_filter_group_definitions(db, principal=principal)

    analytics = build_dashboard_analytics(
        db,
        start=start,
        end=end,
        options=DashboardAnalyticsOptions(
            currency_code=dashboard_currency_code,
            entry_filter=entry_owner_filter(principal),
            account_filter=account_owner_filter(principal),
        ),
        filter_groups=filter_groups,
    )

    as_of = min(date.today(), end - timedelta(days=1))
    accounts = list_dashboard_reconciliation_accounts(
        db,
        currency_code=dashboard_currency_code,
        principal=principal,
    )
    reconciliation = [
        build_dashboard_reconciliation_summary(build_reconciliation(db, account, as_of))
        for account in accounts
    ]

    return DashboardRead(
        month=month,
        currency_code=dashboard_currency_code,
        **analytics,
        reconciliation=reconciliation,
    )


def build_dashboard_timeline_read(
    db: Session,
    *,
    principal: RequestPrincipal,
) -> DashboardTimelineRead:
    runtime_settings = resolve_runtime_settings(db)
    dashboard_currency_code = runtime_settings.dashboard_currency_code
    months = list_dashboard_expense_months(
        db,
        currency_code=dashboard_currency_code,
        principal=principal,
    )
    return DashboardTimelineRead(months=months)


def _shift_month(month_start: date, month_delta: int) -> date:
    normalized_month_index = (month_start.year * 12) + (month_start.month - 1) + month_delta
    year = normalized_month_index // 12
    month = (normalized_month_index % 12) + 1
    return date(year, month, 1)


def _account_entity_ids(
    db: Session,
    *,
    account_filter: DashboardFilter | None = None,
) -> set[str]:
    linked_accounts_stmt = select(Account.id)
    if account_filter is not None:
        linked_accounts_stmt = linked_accounts_stmt.where(account_filter)
    return {entity_id for entity_id in db.scalars(linked_accounts_stmt).all() if entity_id}


def _is_internal_account_transfer(entry: Entry, account_entity_ids: set[str]) -> bool:
    return (
        entry.from_entity_id is not None
        and entry.to_entity_id is not None
        and entry.from_entity_id in account_entity_ids
        and entry.to_entity_id in account_entity_ids
    )


def _entry_has_tag(entry: Entry, tag_name: str) -> bool:
    normalized_tag_name = tag_name.strip().lower()
    return any((tag.name or "").strip().lower() == normalized_tag_name for tag in entry.tags)


def _is_cash_withdrawal_entry(entry: Entry) -> bool:
    return entry.kind in {EntryKind.EXPENSE, EntryKind.TRANSFER} and _entry_has_tag(
        entry,
        CASH_WITHDRAWAL_TAG,
    )


def _list_entries_for_window(
    db: Session,
    start: date,
    end: date,
    currency_code: str,
    *,
    entry_filter: DashboardFilter | None = None,
) -> list[Entry]:
    stmt = (
        select(Entry)
        .where(
            Entry.is_deleted.is_(False),
            Entry.occurred_at >= start,
            Entry.occurred_at < end,
            Entry.currency_code == currency_code,
        )
        .options(selectinload(Entry.tags))
        .order_by(Entry.occurred_at.asc(), Entry.created_at.asc())
    )
    if entry_filter is not None:
        stmt = stmt.where(entry_filter)
    return list(db.scalars(stmt))


def list_dashboard_expense_months(
    db: Session,
    *,
    currency_code: str,
    principal: RequestPrincipal,
) -> list[str]:
    account_entity_ids = _account_entity_ids(
        db,
        account_filter=account_owner_filter(principal),
    )
    entries = db.scalars(
        select(Entry)
        .where(
            Entry.is_deleted.is_(False),
            Entry.currency_code == currency_code.upper(),
            entry_owner_filter(principal),
        )
        .options(selectinload(Entry.tags))
        .order_by(Entry.occurred_at.asc(), Entry.created_at.asc())
    ).all()

    months: list[str] = []
    seen_months: set[str] = set()
    for entry in entries:
        is_visible_expense = (
            entry.kind == EntryKind.EXPENSE
            and not _is_internal_account_transfer(entry, account_entity_ids)
            and not _is_cash_withdrawal_entry(entry)
        )
        if not is_visible_expense and not _is_cash_withdrawal_entry(entry):
            continue
        month_key = entry.occurred_at.strftime("%Y-%m")
        if month_key in seen_months:
            continue
        seen_months.add(month_key)
        months.append(month_key)

    return months


def _list_spending_analytics_entries_for_window(
    db: Session,
    *,
    start: date,
    end: date,
    currency_code: str,
    account_entity_ids: set[str],
    entry_filter: DashboardFilter | None = None,
) -> list[Entry]:
    return [
        entry
        for entry in _list_entries_for_window(
            db,
            start,
            end,
            currency_code,
            entry_filter=entry_filter,
        )
        if not _is_internal_account_transfer(entry, account_entity_ids)
        and not _is_cash_withdrawal_entry(entry)
    ]


def _build_monthly_trend(
    *,
    db: Session,
    start: date,
    end: date,
    currency_code: str,
    trend_months: int,
    account_entity_ids: set[str],
    entry_filter: DashboardFilter | None = None,
) -> list[DashboardMonthlyTrendPoint]:
    normalized_trend_months = max(trend_months, 1)
    trend_start = _shift_month(start, -(normalized_trend_months - 1))
    trend_entries = _list_spending_analytics_entries_for_window(
        db,
        start=trend_start,
        end=end,
        currency_code=currency_code,
        account_entity_ids=account_entity_ids,
        entry_filter=entry_filter,
    )
    category_paths = get_entry_category_path_map(
        db, entry_ids=[entry.id for entry in trend_entries]
    )

    trend_month_keys = [
        _shift_month(start, -offset).strftime("%Y-%m")
        for offset in range(normalized_trend_months - 1, -1, -1)
    ]
    monthly: dict[str, _MonthlyTrendBucket] = {
        month_key: _MonthlyTrendBucket() for month_key in trend_month_keys
    }
    for entry in trend_entries:
        month_key = entry.occurred_at.strftime("%Y-%m")
        bucket = monthly.get(month_key)
        if bucket is None:
            continue
        if entry.kind == EntryKind.INCOME:
            bucket.income_total_minor += entry.amount_minor
            continue
        if entry.kind != EntryKind.EXPENSE:
            continue
        bucket.expense_total_minor += entry.amount_minor
        bucket.category_totals[
            category_top(category_path_key(category_paths.get(entry.id)))
        ] += entry.amount_minor
        bucket.lifecycle_totals[lifecycle_key(entry)] += entry.amount_minor

    return [
        DashboardMonthlyTrendPoint(
            month=month_key,
            expense_total_minor=monthly[month_key].expense_total_minor,
            income_total_minor=monthly[month_key].income_total_minor,
            category_totals=dict(monthly[month_key].category_totals),
            lifecycle_totals=dict(monthly[month_key].lifecycle_totals),
        )
        for month_key in trend_month_keys
    ]


def build_dashboard_analytics(
    db: Session,
    *,
    start: date,
    end: date,
    options: DashboardAnalyticsOptions | None = None,
    filter_groups: list[FilterGroupDefinition] | None = None,
) -> dict[str, object]:
    analytics_options = options or DashboardAnalyticsOptions()
    normalized_currency = analytics_options.currency_code.upper()
    active_filter_groups = filter_groups or []
    account_entity_ids = _account_entity_ids(
        db,
        account_filter=analytics_options.account_filter,
    )
    all_month_entries = _list_entries_for_window(
        db,
        start=start,
        end=end,
        currency_code=normalized_currency,
        entry_filter=analytics_options.entry_filter,
    )
    cash_withdrawal_total_minor = sum(
        entry.amount_minor for entry in all_month_entries if _is_cash_withdrawal_entry(entry)
    )
    month_entries = [
        entry
        for entry in all_month_entries
        if not _is_internal_account_transfer(entry, account_entity_ids)
        and not _is_cash_withdrawal_entry(entry)
    ]
    expense_entries = [entry for entry in month_entries if entry.kind == EntryKind.EXPENSE]
    category_paths = get_entry_category_path_map(
        db, entry_ids=[entry.id for entry in expense_entries]
    )
    rollup = rollup_expense_entries(
        expense_entries,
        category_paths=category_paths,
        filter_groups=active_filter_groups,
        account_entity_ids=account_entity_ids,
    )

    income_entries = [entry for entry in month_entries if entry.kind == EntryKind.INCOME]
    income_total_minor = sum(entry.amount_minor for entry in income_entries)
    income_by_from: dict[str, int] = defaultdict(int)
    for entry in income_entries:
        income_by_from[normalize_breakdown_label(entry.from_entity)] += entry.amount_minor

    expense_total_minor = sum(rollup.expense_totals_by_date.values())
    kpis = build_dashboard_kpis(
        rollup=rollup,
        income_total_minor=income_total_minor,
        cash_withdrawal_total_minor=cash_withdrawal_total_minor,
        expense_total_minor=expense_total_minor,
    )
    daily_spending = build_daily_spending_points(
        start=start,
        end=end,
        rollup=rollup,
        category_tops=ordered_category_tops(rollup),
    )
    monthly_trend = _build_monthly_trend(
        db=db,
        start=start,
        end=end,
        currency_code=normalized_currency,
        trend_months=analytics_options.trend_months,
        account_entity_ids=account_entity_ids,
        entry_filter=analytics_options.entry_filter,
    )
    weekday_spending = build_weekday_spending_points(rollup.weekday_totals)
    projection = build_projection(
        start=start,
        end=end,
        today=analytics_options.today,
        expense_entries=expense_entries,
        expense_total_minor=kpis.expense_total_minor,
        category_paths=category_paths,
    )
    ranked_expenses = rank_expenses(rollup.largest_expenses)

    return {
        "kpis": kpis,
        "categories": build_category_summaries(rollup, expense_total_minor=expense_total_minor),
        "lifecycles": build_lifecycle_summaries(rollup, expense_total_minor=expense_total_minor),
        "filter_groups": build_filter_group_summaries(
            rollup, active_filter_groups, expense_total_minor=expense_total_minor
        ),
        "daily_spending": daily_spending,
        "monthly_trend": monthly_trend,
        "spending_by_from": build_breakdown_items(rollup.spending_by_from),
        "spending_by_to": build_breakdown_items(
            rollup.spending_by_to,
            limit=DASHBOARD_DESTINATION_BREAKDOWN_LIMIT,
        ),
        "spending_by_tag": build_breakdown_items(rollup.spending_by_tag),
        "income_by_from": build_breakdown_items(income_by_from),
        "weekday_spending": weekday_spending,
        "largest_expenses": ranked_expenses[:8],
        "projection": projection,
    }


__all__ = [
    "DashboardAnalyticsOptions",
    "DashboardFilter",
    "DASHBOARD_DEFAULT_CURRENCY_CODE",
    "build_dashboard_analytics",
    "build_dashboard_read",
    "build_dashboard_timeline_read",
    "list_dashboard_expense_months",
    "month_window",
]
