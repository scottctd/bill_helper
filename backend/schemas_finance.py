# CALLING SPEC:
# - Purpose: HTTP request/response pydantic models for ledger, groups, and dashboard reads.
# - Inputs: FastAPI route bodies and ORM rows mapped into read models.
# - Outputs: validated schemas; HTTP entry writes use `entry_*_command_from_http` adapters.
# - Side effects: none.
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.contracts_groups import GroupCreateCommand, GroupMemberCreateCommand, GroupPatch
from backend.contracts_users import UserCreateCommand, UserPatch
from backend.enums_finance import EntryKind, EntryLifecycle, GroupMemberOverride, GroupSource
from backend.schemas_group_rules import GroupRule
from backend.validation.contract_fields import NonEmptyPatchModel
from backend.validation.finance_names import normalize_tag_name


class TagSummaryRead(BaseModel):
    id: int
    name: str
    color: str | None = None
    description: str | None = None
    type: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TagRead(TagSummaryRead):
    entry_count: int



class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=2000)
    type: str | None = Field(default=None, max_length=100)


class TagUpdate(NonEmptyPatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=2000)
    type: str | None = Field(default=None, max_length=100)


class EntityRead(BaseModel):
    id: str
    name: str
    category: str | None = None
    is_account: bool = False
    from_count: int | None = None
    to_count: int | None = None
    account_count: int | None = None
    entry_count: int | None = None
    net_amount_minor: int | None = None
    net_amount_currency_code: str | None = None
    net_amount_mixed_currencies: bool = False

    model_config = ConfigDict(from_attributes=True)


class EntityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=100)


class EntityUpdate(NonEmptyPatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=100)


class UserRead(BaseModel):
    id: str
    name: str
    is_admin: bool = False
    is_current_user: bool = False
    account_count: int | None = None
    entry_count: int | None = None

    model_config = ConfigDict(from_attributes=True)


class UserCreate(UserCreateCommand):
    pass


class UserUpdate(UserPatch):
    pass


class CurrencyRead(BaseModel):
    code: str = Field(min_length=3, max_length=3)
    name: str
    entry_count: int
    is_placeholder: bool


class TaxonomyRead(BaseModel):
    id: str
    key: str
    applies_to: str
    cardinality: str
    display_name: str

    model_config = ConfigDict(from_attributes=True)


class TaxonomyTermCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    parent_term_id: str | None = Field(default=None, min_length=1)
    default_lifecycle: EntryLifecycle | None = None


class TaxonomyTermUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    default_lifecycle: EntryLifecycle | None = None


class TaxonomyTermRead(BaseModel):
    id: str
    taxonomy_id: str
    name: str
    normalized_name: str
    parent_term_id: str | None = None
    description: str | None = None
    default_lifecycle: EntryLifecycle | None = None
    usage_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class AccountBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    markdown_body: str | None = None
    currency_code: str = Field(min_length=3, max_length=3)


class AccountCreate(AccountBase):
    owner_user_id: str | None = Field(default=None, min_length=1)
    is_active: bool = True


class AccountUpdate(NonEmptyPatchModel):
    owner_user_id: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    markdown_body: str | None = None
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    is_active: bool | None = None


class AccountRead(AccountBase):
    id: str
    owner_user_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    balance_minor: int
    balance_as_of: date
    latest_snapshot_at: date | None = None

    model_config = ConfigDict(from_attributes=True)


class SnapshotCreate(BaseModel):
    snapshot_at: date
    balance_minor: int
    note: str | None = None


class SnapshotRead(BaseModel):
    id: str
    account_id: str
    snapshot_at: date
    balance_minor: int
    note: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SnapshotSummaryRead(BaseModel):
    id: str
    snapshot_at: date
    balance_minor: int
    note: str | None = None


class ReconciliationIntervalRead(BaseModel):
    start_snapshot: SnapshotSummaryRead
    end_snapshot: SnapshotSummaryRead | None = None
    is_open: bool
    tracked_change_minor: int
    bank_change_minor: int | None = None
    delta_minor: int | None = None
    entry_count: int


class ReconciliationRead(BaseModel):
    account_id: str
    account_name: str
    currency_code: str
    as_of: date
    intervals: list[ReconciliationIntervalRead] = Field(default_factory=list)


class DashboardReconciliationRead(BaseModel):
    account_id: str
    account_name: str
    currency_code: str
    latest_snapshot_at: date | None = None
    current_tracked_change_minor: int | None = None
    last_closed_delta_minor: int | None = None
    mismatched_interval_count: int
    reconciled_interval_count: int


class EntryBase(BaseModel):
    kind: EntryKind
    occurred_at: date
    name: str = Field(min_length=1, max_length=255)
    amount_minor: int = Field(gt=0)
    currency_code: str = Field(min_length=3, max_length=3)
    from_entity_id: str | None = None
    to_entity_id: str | None = None
    owner_user_id: str | None = Field(default=None, min_length=1)
    from_entity: str | None = Field(default=None, max_length=255)
    to_entity: str | None = Field(default=None, max_length=255)
    owner: str | None = Field(default=None, max_length=255)
    markdown_body: str | None = None


class EntryCreate(EntryBase):
    tags: list[str] = Field(default_factory=list)
    group_ids: list[str] = Field(default_factory=list)
    category: str | None = Field(default=None, min_length=1, max_length=120)
    lifecycle: EntryLifecycle | None = None


class EntryUpdate(BaseModel):
    kind: EntryKind | None = None
    occurred_at: date | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    amount_minor: int | None = Field(default=None, gt=0)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    from_entity_id: str | None = None
    to_entity_id: str | None = None
    owner_user_id: str | None = Field(default=None, min_length=1)
    from_entity: str | None = Field(default=None, max_length=255)
    to_entity: str | None = Field(default=None, max_length=255)
    owner: str | None = Field(default=None, max_length=255)
    markdown_body: str | None = None
    tags: list[str] | None = None
    group_ids: list[str] | None = None
    category: str | None = Field(default=None, min_length=1, max_length=120)
    lifecycle: EntryLifecycle | None = None


class EntryRead(BaseModel):
    id: str
    kind: EntryKind
    occurred_at: date
    name: str
    amount_minor: int
    currency_code: str
    from_entity_id: str | None = None
    to_entity_id: str | None = None
    owner_user_id: str
    from_entity: str | None = None
    from_entity_missing: bool = False
    to_entity: str | None = None
    to_entity_missing: bool = False
    owner: str | None = None
    markdown_body: str | None = None
    lifecycle: EntryLifecycle | None = None
    category: str | None = None
    created_at: datetime
    updated_at: datetime
    tags: list[TagSummaryRead] = Field(default_factory=list)
    groups: list["GroupRefRead"] = Field(default_factory=list)


class EntryDetailRead(EntryRead):
    pass


class EntryListResponse(BaseModel):
    items: list[EntryRead]
    total: int
    limit: int
    offset: int


class EntryTagSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_id: str | None = None
    kind: EntryKind
    occurred_at: date
    currency_code: str = Field(min_length=3, max_length=3)
    amount_minor: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, max_length=255)
    from_entity_id: str | None = None
    from_entity: str | None = Field(default=None, max_length=255)
    to_entity_id: str | None = None
    to_entity: str | None = Field(default=None, max_length=255)
    owner_user_id: str | None = None
    markdown_body: str | None = None
    current_tags: list[str] = Field(default_factory=list)
    current_category: str | None = None
    current_lifecycle: EntryLifecycle | None = None

    @field_validator("currency_code", mode="before")
    @classmethod
    def normalize_currency_code(cls, value: object) -> str:
        normalized = " ".join(str(value or "").split()).strip().upper()
        if len(normalized) != 3:
            raise ValueError("currency_code must use a 3-letter ISO code")
        return normalized


class EntryTagSuggestionResponse(BaseModel):
    suggested_tags: list[str] = Field(default_factory=list)
    suggested_category: str | None = None
    suggested_lifecycle: EntryLifecycle | None = None


class GroupRefRead(BaseModel):
    id: str
    name: str
    source: GroupSource
    color: str | None = None


class GroupSummaryRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    color: str | None = None
    source: GroupSource
    rule_summary: str | None = None
    member_count: int
    first_occurred_at: date | None = None
    last_occurred_at: date | None = None
    position: int
    created_at: datetime
    updated_at: datetime


class GroupMemberRead(BaseModel):
    id: str
    entry_id: str
    override: GroupMemberOverride | None = None
    entry_name: str
    occurred_at: date
    kind: EntryKind
    amount_minor: int
    currency_code: str


class GroupRead(GroupSummaryRead):
    members: list[GroupMemberRead] = Field(default_factory=list)
    rule: GroupRule | None = None


class GroupCreate(GroupCreateCommand):
    pass


class GroupUpdate(GroupPatch):
    pass


class GroupMemberCreate(GroupMemberCreateCommand):
    pass


EntryRead.model_rebuild()


class DailyExpensePoint(BaseModel):
    date: date
    currency_code: str
    total_minor: int


class TagBreakdownItem(BaseModel):
    tag: str
    currency_code: str
    total_minor: int


class DashboardKpisRead(BaseModel):
    expense_total_minor: int
    income_total_minor: int
    net_total_minor: int
    cash_withdrawal_total_minor: int = 0
    average_expense_day_minor: int
    median_expense_day_minor: int
    spending_days: int
    one_time_total_minor: int = 0
    core_spend_minor: int = 0
    uncategorized_total_minor: int = 0


class DashboardBreakdownEntryItem(BaseModel):
    id: str
    occurred_at: date
    name: str
    amount_minor: int


class DashboardToBreakdownItem(BaseModel):
    label: str
    total_minor: int
    share: float
    entries: list[DashboardBreakdownEntryItem] = Field(default_factory=list)


class DashboardCategoryChildSummary(BaseModel):
    name: str
    path: str
    total_minor: int
    share: float
    entry_count: int = 0
    to_breakdown: list[DashboardToBreakdownItem] = Field(default_factory=list)


class DashboardCategorySummary(BaseModel):
    name: str
    total_minor: int
    share: float
    entry_count: int = 0
    children: list[DashboardCategoryChildSummary] = Field(default_factory=list)
    to_breakdown: list[DashboardToBreakdownItem] = Field(default_factory=list)


class DashboardLifecycleSummary(BaseModel):
    lifecycle: str | None
    total_minor: int
    share: float
    entry_count: int


class DashboardGroupSummary(BaseModel):
    group_id: str
    name: str
    source: GroupSource
    color: str | None = None
    total_minor: int
    share: float
    entry_count: int = 0


class DashboardDailySpendingPoint(BaseModel):
    date: date
    expense_total_minor: int
    category_totals: dict[str, int] = Field(default_factory=dict)


class DashboardMonthlyTrendPoint(BaseModel):
    month: str
    expense_total_minor: int
    income_total_minor: int
    category_totals: dict[str, int] = Field(default_factory=dict)
    lifecycle_totals: dict[str, int] = Field(default_factory=dict)


class DashboardBreakdownItem(BaseModel):
    label: str
    total_minor: int
    share: float


class DashboardWeekdaySpendingPoint(BaseModel):
    weekday: str
    total_minor: int


class DashboardLargestExpenseItem(BaseModel):
    id: str
    occurred_at: date
    name: str
    to_entity: str | None = None
    amount_minor: int
    category: str | None = None
    lifecycle: str | None = None


class DashboardProjectionRead(BaseModel):
    is_current_month: bool
    days_elapsed: int
    days_remaining: int
    spent_to_date_minor: int
    projected_total_minor: int | None = None
    projected_remaining_minor: int | None = None
    projected_category_totals: dict[str, int] = Field(default_factory=dict)


class DashboardTimelineRead(BaseModel):
    months: list[str] = Field(default_factory=list)


class DashboardRead(BaseModel):
    month: str
    currency_code: str
    kpis: DashboardKpisRead
    categories: list[DashboardCategorySummary]
    lifecycles: list[DashboardLifecycleSummary]
    groups: list[DashboardGroupSummary]
    daily_spending: list[DashboardDailySpendingPoint]
    monthly_trend: list[DashboardMonthlyTrendPoint]
    spending_by_from: list[DashboardBreakdownItem]
    spending_by_to: list[DashboardBreakdownItem]
    spending_by_tag: list[DashboardBreakdownItem]
    income_by_from: list[DashboardBreakdownItem]
    weekday_spending: list[DashboardWeekdaySpendingPoint]
    largest_expenses: list[DashboardLargestExpenseItem]
    projection: DashboardProjectionRead
    reconciliation: list[DashboardReconciliationRead]


class DashboardBatchRead(BaseModel):
    dashboards: list[DashboardRead] = Field(default_factory=list)
