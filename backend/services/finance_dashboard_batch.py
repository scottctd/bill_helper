# CALLING SPEC:
# - Purpose: build multi-month dashboard read models in one service call.
# - Inputs: SQLAlchemy session, ordered month keys, and request principal.
# - Outputs: batch dashboard payload with one read model per requested month.
# - Side effects: reads database state only.

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.schemas_finance import DashboardBatchRead, DashboardRead
from backend.services.finance_dashboard import build_dashboard_read, month_window

_MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")
_MAX_BATCH_MONTHS = 24


def normalize_dashboard_batch_months(months: list[str]) -> list[str]:
    if not months:
        raise ValueError("months must include at least one YYYY-MM value")
    if len(months) > _MAX_BATCH_MONTHS:
        raise ValueError(f"months must include at most {_MAX_BATCH_MONTHS} values")

    normalized: list[str] = []
    seen: set[str] = set()
    for month in months:
        candidate = month.strip()
        if not _MONTH_PATTERN.fullmatch(candidate):
            raise ValueError("each month must be in YYYY-MM format")
        try:
            month_window(candidate)
        except ValueError as exc:
            raise ValueError("each month must be in YYYY-MM format") from exc
        if candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)

    if not normalized:
        raise ValueError("months must include at least one YYYY-MM value")
    return sorted(normalized)


def build_dashboard_batch_read(
    db: Session,
    *,
    months: list[str],
    principal: RequestPrincipal,
) -> DashboardBatchRead:
    normalized_months = normalize_dashboard_batch_months(months)
    dashboards: list[DashboardRead] = [
        build_dashboard_read(db, month=month, principal=principal) for month in normalized_months
    ]
    return DashboardBatchRead(dashboards=dashboards)
