# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `dashboard` routes.
# - Inputs: authenticated principal, validated dashboard month query params, and DB session.
# - Outputs: dashboard read payloads mapped from finance dashboard services.
# - Side effects: HTTP routing only; read endpoints do not commit.
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_finance import DashboardBatchRead, DashboardRead, DashboardTimelineRead
from backend.services.finance_dashboard import (
    build_dashboard_read,
    build_dashboard_timeline_read,
    parse_dashboard_month,
)
from backend.services.finance_dashboard_batch import build_dashboard_batch_read

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _dashboard_month_query(
    month: Annotated[
        str,
        Query(default_factory=lambda: date.today().strftime("%Y-%m"), pattern=r"^\d{4}-\d{2}$"),
    ],
) -> str:
    return parse_dashboard_month(month)


@router.get("", response_model=DashboardRead)
def get_dashboard(
    month: Annotated[str, Depends(_dashboard_month_query)],
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> DashboardRead:
    return build_dashboard_read(db, month=month, principal=principal)


@router.get("/timeline", response_model=DashboardTimelineRead)
def get_dashboard_timeline(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> DashboardTimelineRead:
    return build_dashboard_timeline_read(db, principal=principal)


@router.get("/batch", response_model=DashboardBatchRead)
def get_dashboard_batch(
    months: list[str] = Query(..., min_length=1, max_length=24),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> DashboardBatchRead:
    return build_dashboard_batch_read(db, months=months, principal=principal)
