# CALLING SPEC:
# - Purpose: provide the `contracts_groups` module.
# - Inputs: callers that import `backend/contracts_groups.py` and pass module-defined arguments or framework events.
# - Outputs: module exports from `contracts_groups`.
# - Side effects: module-local behavior only.
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.enums_finance import GroupMemberOverride, GroupSource
from backend.schemas_group_rules import GroupRule
from backend.validation.contract_fields import NonEmptyPatchModel, OptionalRequiredText, RequiredLooseText


class GroupCreateCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: RequiredLooseText = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, max_length=20)
    source: GroupSource = GroupSource.MANUAL
    rule: GroupRule | None = None

    @model_validator(mode="after")
    def validate_source_rule(self) -> GroupCreateCommand:
        if self.source == GroupSource.RULE and self.rule is None:
            raise ValueError("rule is required for rule groups")
        if self.source == GroupSource.MANUAL and self.rule is not None:
            raise ValueError("manual groups cannot include a rule")
        return self


class GroupPatch(NonEmptyPatchModel):
    model_config = ConfigDict(extra="forbid")

    name: OptionalRequiredText = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, max_length=20)
    rule: GroupRule | None = None


class GroupMemberCreateCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_id: str
    override: GroupMemberOverride | None = None
