# CALLING SPEC:
# - Purpose: provide the `enums_finance` module.
# - Inputs: callers that import `backend/enums_finance.py` and pass module-defined arguments or framework events.
# - Outputs: module exports from `enums_finance`.
# - Side effects: module-local behavior only.
from __future__ import annotations

from enum import StrEnum


class EntryKind(StrEnum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"
    TRANSFER = "TRANSFER"


class EntryLifecycle(StrEnum):
    FIXED = "fixed"
    DAY_TO_DAY = "day_to_day"
    ONE_TIME = "one_time"


class GroupSource(StrEnum):
    MANUAL = "manual"
    RULE = "rule"


class GroupMemberOverride(StrEnum):
    INCLUDE = "include"
    EXCLUDE = "exclude"
