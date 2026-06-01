# CALLING SPEC:
# - Purpose: compute tracked account balances from snapshots and ledger entry effects.
# - Inputs: SQLAlchemy session, account ids, and as-of dates.
# - Outputs: balance_minor values and optional latest snapshot dates per account.
# - Side effects: reads database state only.

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from backend.models_finance import AccountSnapshot, Entry

LEDGER_EPOCH = date(1900, 1, 1)


def account_entry_effect_case(account_id: str) -> ColumnElement[int]:
    return case(
        (
            and_(
                Entry.from_entity_id == account_id,
                Entry.to_entity_id == account_id,
            ),
            0,
        ),
        (Entry.from_entity_id == account_id, -Entry.amount_minor),
        (Entry.to_entity_id == account_id, Entry.amount_minor),
        else_=None,
    )


def account_entry_filter(account_id: str) -> ColumnElement[bool]:
    return or_(
        Entry.from_entity_id == account_id,
        Entry.to_entity_id == account_id,
    )


def sum_account_entry_effects(
    db: Session,
    *,
    account_id: str,
    start_exclusive: date,
    end_inclusive: date,
) -> int:
    if end_inclusive < start_exclusive:
        return 0

    account_effect = account_entry_effect_case(account_id)
    total = db.scalar(
        select(func.coalesce(func.sum(account_effect), 0)).where(
            Entry.is_deleted.is_(False),
            Entry.occurred_at > start_exclusive,
            Entry.occurred_at <= end_inclusive,
            account_entry_filter(account_id),
        )
    )
    return int(total or 0)


def get_latest_snapshot(
    db: Session,
    *,
    account_id: str,
    as_of: date,
) -> AccountSnapshot | None:
    return db.scalar(
        select(AccountSnapshot)
        .where(
            AccountSnapshot.account_id == account_id,
            AccountSnapshot.snapshot_at <= as_of,
        )
        .order_by(
            AccountSnapshot.snapshot_at.desc(),
            AccountSnapshot.created_at.desc(),
        )
        .limit(1)
    )


@dataclass(frozen=True)
class AccountBalanceSnapshot:
    balance_minor: int
    balance_as_of: date
    latest_snapshot_at: date | None


def compute_account_balance(
    db: Session,
    *,
    account_id: str,
    as_of: date,
) -> AccountBalanceSnapshot:
    latest_snapshot = get_latest_snapshot(db, account_id=account_id, as_of=as_of)
    if latest_snapshot is None:
        tracked_change = sum_account_entry_effects(
            db,
            account_id=account_id,
            start_exclusive=LEDGER_EPOCH,
            end_inclusive=as_of,
        )
        return AccountBalanceSnapshot(
            balance_minor=tracked_change,
            balance_as_of=as_of,
            latest_snapshot_at=None,
        )

    tracked_change = sum_account_entry_effects(
        db,
        account_id=account_id,
        start_exclusive=latest_snapshot.snapshot_at,
        end_inclusive=as_of,
    )
    return AccountBalanceSnapshot(
        balance_minor=latest_snapshot.balance_minor + tracked_change,
        balance_as_of=as_of,
        latest_snapshot_at=latest_snapshot.snapshot_at,
    )


def compute_account_balances(
    db: Session,
    *,
    account_ids: list[str],
    as_of: date,
) -> dict[str, AccountBalanceSnapshot]:
    if not account_ids:
        return {}

    return {
        account_id: compute_account_balance(db, account_id=account_id, as_of=as_of)
        for account_id in account_ids
    }


__all__ = [
    "AccountBalanceSnapshot",
    "LEDGER_EPOCH",
    "account_entry_effect_case",
    "account_entry_filter",
    "compute_account_balance",
    "compute_account_balances",
    "get_latest_snapshot",
    "sum_account_entry_effects",
]
