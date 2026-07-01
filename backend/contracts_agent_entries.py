# CALLING SPEC:
# - Purpose: agent-facing entry proposal payload contracts (`date`, `markdown_notes`, etc.).
# - Inputs: proposal JSON from HTTP routes, CLI tools, and stored change-item rows.
# - Outputs: validated payload models with `to_create_command(default_currency_code=...)`.
# - Side effects: none; conversion to ledger commands happens at apply time.
from __future__ import annotations

from datetime import date as DateValue

from pydantic import BaseModel, ConfigDict, Field

from backend.enums_finance import EntryKind, EntryLifecycle
from backend.contracts_entries import EntityRef, EntryCreateCommand
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

    def to_create_command(self, *, default_currency_code: str) -> EntryCreateCommand:
        currency_code = (self.currency_code or default_currency_code).strip().upper()
        return EntryCreateCommand(
            kind=self.kind,
            occurred_at=self.date,
            name=self.name,
            amount_minor=self.amount_minor,
            currency_code=currency_code,
            from_ref=EntityRef(name=self.from_entity),
            to_ref=EntityRef(name=self.to_entity),
            markdown_body=self.markdown_notes,
            tags=list(self.tags),
            category=self.category,
            lifecycle=self.lifecycle,
        )


class BatchImportEntriesPayload(ChangePayloadModel):
    entries: list[CreateEntryPayload] = Field(min_length=1, max_length=100)
