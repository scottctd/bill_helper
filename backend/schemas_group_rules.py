# CALLING SPEC:
# - Purpose: define group rule tree schemas shared by contracts, services, and API layers.
# - Inputs: callers that import `backend/schemas_group_rules.py` and pass rule JSON or payloads.
# - Outputs: validated group rule schema models.
# - Side effects: module-local validation only.
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.enums_finance import EntryKind
from backend.validation.finance_names import normalize_tag_name

GroupRuleField = Literal[
    "entry_kind",
    "tags",
    "is_internal_transfer",
    "category",
    "from_entity",
    "to_entity",
    "amount_minor",
    "occurred_at",
]
GroupRuleConditionOperator = Literal[
    "is",
    "has_any",
    "has_none",
    "starts_with",
    "gte",
    "lte",
    "eq",
    "between",
    "before",
    "after",
]
GroupRuleLogicalOperator = Literal["AND", "OR"]


class GroupRuleCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["condition"] = "condition"
    field: GroupRuleField
    operator: GroupRuleConditionOperator
    value: str | bool | int | list[str] | list[int]

    @model_validator(mode="after")
    def validate_condition(self) -> GroupRuleCondition:
        if self.field == "entry_kind":
            if self.operator != "is":
                raise ValueError("entry_kind supports only the 'is' operator")
            if not isinstance(self.value, str):
                raise ValueError("entry_kind condition value must be a string")
            EntryKind(self.value)
            return self

        if self.field == "is_internal_transfer":
            if self.operator != "is":
                raise ValueError("is_internal_transfer supports only the 'is' operator")
            if not isinstance(self.value, bool):
                raise ValueError("is_internal_transfer condition value must be a boolean")
            return self

        if self.field == "tags":
            if self.operator not in {"has_any", "has_none"}:
                raise ValueError("tags support only 'has_any' or 'has_none' operators")
            if not isinstance(self.value, list) or not self.value:
                raise ValueError("tags condition value must be a non-empty list")
            normalized_values = [normalize_tag_name(str(item)) for item in self.value if str(item).strip()]
            normalized_values = sorted({item for item in normalized_values if item})
            if not normalized_values:
                raise ValueError("tags condition value must include at least one tag")
            self.value = normalized_values
            return self

        if self.field == "category":
            if self.operator not in {"is", "starts_with"}:
                raise ValueError("category supports only 'is' or 'starts_with' operators")
            if not isinstance(self.value, str) or not self.value.strip():
                raise ValueError("category condition value must be a non-empty string")
            self.value = self.value.strip()
            return self

        if self.field in {"from_entity", "to_entity"}:
            if self.operator != "is":
                raise ValueError(f"{self.field} supports only the 'is' operator")
            if not isinstance(self.value, str) or not self.value.strip():
                raise ValueError(f"{self.field} condition value must be a non-empty string")
            self.value = self.value.strip()
            return self

        if self.field == "amount_minor":
            if self.operator not in {"gte", "lte", "eq", "between"}:
                raise ValueError("amount_minor supports gte, lte, eq, or between operators")
            if self.operator == "between":
                if not isinstance(self.value, list) or len(self.value) != 2:
                    raise ValueError("amount_minor between value must be a two-item list")
                self.value = [int(self.value[0]), int(self.value[1])]
                return self
            if not isinstance(self.value, int):
                raise ValueError("amount_minor condition value must be an integer")
            return self

        if self.field == "occurred_at":
            if self.operator not in {"before", "after", "between"}:
                raise ValueError("occurred_at supports before, after, or between operators")
            if self.operator == "between":
                if not isinstance(self.value, list) or len(self.value) != 2:
                    raise ValueError("occurred_at between value must be a two-item list")
                return self
            if not isinstance(self.value, str) or not self.value.strip():
                raise ValueError("occurred_at condition value must be a date string")
            self.value = self.value.strip()
            return self

        raise ValueError(f"Unsupported group rule condition field '{self.field}'")


class GroupRuleGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["group"] = "group"
    operator: GroupRuleLogicalOperator
    children: list["GroupRuleNode"] = Field(default_factory=list, min_length=1)


GroupRuleNode = Annotated[
    GroupRuleCondition | GroupRuleGroup,
    Field(discriminator="type"),
]


class GroupRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include: GroupRuleGroup
    exclude: GroupRuleGroup | None = None


GroupRuleGroup.model_rebuild()

