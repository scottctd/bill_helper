# CALLING SPEC:
# - Purpose: agent entry change-contract payloads for update/delete/reference proposals.
# - Inputs: proposal JSON validated by the change-contract registry and CLI parsers.
# - Outputs: payload models; `UpdateEntryPayload.to_update_command()` for apply.
# - Side effects: none; re-exports `CreateEntryPayload` from `contracts_agent_entries`.
from __future__ import annotations

from datetime import date as DateValue
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.enums_finance import EntryKind, EntryLifecycle
from backend.contracts_agent_entries import BatchImportEntriesPayload, CreateEntryPayload
from backend.contracts_entries import EntityRefPatch, EntryUpdateCommand
from backend.services.agent.change_contracts.common import (
    normalize_optional_proposal_id,
    normalize_optional_reference_id,
)
from backend.validation.contract_fields import (
    NonEmptyPatchModel,
    NormalizedTagList,
    OptionalCurrencyCode,
    OptionalEntityName,
    RequiredEntityName,
)


class ChangePayloadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UpdateEntryPatchPayload(NonEmptyPatchModel):
    kind: EntryKind | None = None
    date: DateValue | None = None
    name: OptionalEntityName = Field(default=None, min_length=1, max_length=255)
    amount_minor: int | None = Field(default=None, gt=0)
    currency_code: OptionalCurrencyCode = Field(default=None, min_length=3, max_length=3)
    from_entity: OptionalEntityName = Field(default=None, min_length=1, max_length=255)
    to_entity: OptionalEntityName = Field(default=None, min_length=1, max_length=255)
    tags: NormalizedTagList | None = None
    markdown_notes: str | None = None
    category: str | None = Field(default=None, min_length=1, max_length=120)
    lifecycle: EntryLifecycle | None = None


class UpdateEntryPayload(ChangePayloadModel):
    entry_id: str = Field(min_length=4, max_length=36)
    patch: UpdateEntryPatchPayload
    target: dict[str, Any] | None = None

    @field_validator("entry_id")
    @classmethod
    def normalize_entry_id(cls, value: str) -> str:
        normalized = normalize_optional_reference_id(value)
        if normalized is None:
            raise ValueError("entry_id is required")
        return normalized

    def to_update_command(self) -> EntryUpdateCommand:
        patch = self.patch
        fields_set = set(patch.model_fields_set)
        command_payload: dict[str, object] = {}
        if "kind" in fields_set:
            command_payload["kind"] = patch.kind
        if "date" in fields_set:
            command_payload["occurred_at"] = patch.date
        if "name" in fields_set:
            command_payload["name"] = patch.name
        if "amount_minor" in fields_set:
            command_payload["amount_minor"] = patch.amount_minor
        if "currency_code" in fields_set:
            command_payload["currency_code"] = patch.currency_code
        if "markdown_notes" in fields_set:
            command_payload["markdown_body"] = patch.markdown_notes
        if "tags" in fields_set:
            command_payload["tags"] = patch.tags
        if "category" in fields_set:
            command_payload["category"] = patch.category
        if "lifecycle" in fields_set:
            command_payload["lifecycle"] = patch.lifecycle
        if "from_entity" in fields_set:
            command_payload["from_ref"] = EntityRefPatch(name=patch.from_entity)
        if "to_entity" in fields_set:
            command_payload["to_ref"] = EntityRefPatch(name=patch.to_entity)
        return EntryUpdateCommand.model_validate(command_payload)


class DeleteEntryPayload(ChangePayloadModel):
    entry_id: str = Field(min_length=4, max_length=36)
    target: dict[str, Any] | None = None

    @field_validator("entry_id")
    @classmethod
    def normalize_entry_id(cls, value: str) -> str:
        normalized = normalize_optional_reference_id(value)
        if normalized is None:
            raise ValueError("entry_id is required")
        return normalized


class EntryReferencePayload(ChangePayloadModel):
    entry_id: str | None = Field(default=None, min_length=4, max_length=36)
    create_entry_proposal_id: str | None = Field(default=None, min_length=4, max_length=36)

    @field_validator("entry_id")
    @classmethod
    def normalize_entry_id(cls, value: str | None) -> str | None:
        return normalize_optional_reference_id(value)

    @field_validator("create_entry_proposal_id")
    @classmethod
    def normalize_create_entry_proposal_id(cls, value: str | None) -> str | None:
        return normalize_optional_proposal_id(value)

    @model_validator(mode="after")
    def ensure_reference_present(self) -> EntryReferencePayload:
        if (self.entry_id is None) == (self.create_entry_proposal_id is None):
            raise ValueError("exactly one of entry_id or create_entry_proposal_id is required")
        return self
