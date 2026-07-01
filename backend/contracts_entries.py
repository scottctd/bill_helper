# CALLING SPEC:
# - Purpose: shared entry mutation command models and typed entity/user refs.
# - Inputs: validated command payloads from HTTP adapters, agent apply, or service callers.
# - Outputs: `EntryCreateCommand`, `EntryUpdateCommand`, and ref patch models.
# - Side effects: none.
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.enums_finance import EntryKind, EntryLifecycle


class EntityRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str | None = None
    name: str | None = None

    @model_validator(mode="after")
    def validate_reference_present(self) -> EntityRef:
        if self.entity_id is None and self.name is None:
            raise ValueError("entity ref requires entity_id or name")
        return self


class EntityRefPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str | None = None
    name: str | None = None


class UserRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str | None = None
    name: str | None = None

    @model_validator(mode="after")
    def validate_reference_present(self) -> UserRef:
        if self.user_id is None and self.name is None:
            raise ValueError("user ref requires user_id or name")
        return self


class UserRefPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str | None = None
    name: str | None = None


class EntryCreateCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: EntryKind
    occurred_at: date
    name: str
    amount_minor: int
    currency_code: str
    from_ref: EntityRef | None = None
    to_ref: EntityRef | None = None
    owner_ref: UserRef | None = None
    markdown_body: str | None = None
    tags: list[str] = Field(default_factory=list)
    group_ids: list[str] = Field(default_factory=list)
    category: str | None = None
    lifecycle: EntryLifecycle | None = None


class EntryUpdateCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: EntryKind | None = None
    occurred_at: date | None = None
    name: str | None = None
    amount_minor: int | None = None
    currency_code: str | None = None
    from_ref: EntityRefPatch | None = None
    to_ref: EntityRefPatch | None = None
    owner_ref: UserRefPatch | None = None
    markdown_body: str | None = None
    tags: list[str] | None = None
    group_ids: list[str] | None = None
    category: str | None = None
    lifecycle: EntryLifecycle | None = None
