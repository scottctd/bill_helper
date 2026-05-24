from __future__ import annotations

import pytest

from backend.services.finance_dashboard_batch import normalize_dashboard_batch_months


def test_normalize_dashboard_batch_months_deduplicates_and_sorts() -> None:
    assert normalize_dashboard_batch_months(["2026-02", "2026-01", "2026-02"]) == [
        "2026-01",
        "2026-02",
    ]


def test_normalize_dashboard_batch_months_rejects_invalid_month() -> None:
    with pytest.raises(ValueError, match="YYYY-MM"):
        normalize_dashboard_batch_months(["2026-13"])


def test_normalize_dashboard_batch_months_rejects_empty_list() -> None:
    with pytest.raises(ValueError, match="at least one"):
        normalize_dashboard_batch_months([])
