# CALLING SPEC:
# - Purpose: shared agent entry proposal payload contracts for HTTP and change items.
# - Inputs: schema modules and agent change-contract validators.
# - Outputs: CreateEntryPayload and batch import payload models.
# - Side effects: none.
from __future__ import annotations

from datetime import date as DateValue

from pydantic import BaseModel, ConfigDict, Field

from backend.enums_finance import EntryKind, EntryLifecycle
from backend.validation.contract_fields import (
    NormalizedTagList,
    OptionalCurrencyCode,
    RequiredEntityName,
)


class ChangePayloadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateEntryPayload(ChangePayloadModel):
    kind: EntryKind
    date: DateValue
    name: RequiredEntityName = Field(min_length=1, max_length=255)
    amount_minor: int = Field(gt=0)
    currency_code: OptionalCurrencyCode = Field(default=None, min_length=3, max_length=3)
    from_entity: RequiredEntityName = Field(min_length=1, max_length=255)
    to_entity: RequiredEntityName = Field(min_length=1, max_length=255)
    tags: NormalizedTagList = Field(default_factory=list)
    markdown_notes: str | None = None
    category: str | None = Field(default=None, min_length=1, max_length=120)
    lifecycle: EntryLifecycle | None = None


class BatchImportEntriesPayload(ChangePayloadModel):
    entries: list[CreateEntryPayload] = Field(min_length=1, max_length=100)
