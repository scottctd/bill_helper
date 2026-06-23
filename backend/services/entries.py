# CALLING SPEC:
# - Purpose: implement focused service logic for `entries`.
# - Inputs: callers that import `backend/services/entries.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `entries`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from datetime import date, datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import EntryKind, EntryLifecycle
from backend.models_finance import Entity, Entry, GroupMember, Tag
from backend.services.access_scope import (
    ensure_principal_can_assign_user,
    load_entry_for_principal,
    load_user_for_principal,
)
from backend.services.crud_policy import PolicyViolation
from backend.services.entities import ensure_entity_by_name
from backend.services.groups import load_group, set_entry_manual_group_ids
from backend.services.tags import generate_random_tag_color
from backend.services.taxonomy import (
    assign_single_term_by_name,
    ensure_taxonomy_by_key,
    entry_category_term_names,
    normalize_term_name,
)
from backend.services.taxonomy_constants import ENTRY_CATEGORY_SUBJECT_TYPE, ENTRY_CATEGORY_TAXONOMY_KEY
from backend.services.users import find_user_by_name, normalize_user_name
from backend.validation.finance_names import normalize_entity_name, normalize_tag_name


def normalize_entry_category_reference(category: str) -> str:
    """Accept a leaf name or path such as food_drink/groceries and return the normalized term name."""
    leaf = category.rstrip("/").rsplit("/", 1)[-1]
    return normalize_term_name(leaf)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


def signed_amount_minor(kind: EntryKind, amount_minor: int) -> int:
    if kind == EntryKind.INCOME:
        return amount_minor
    return -amount_minor


def normalize_required_tag_name(name: str) -> str:
    normalized = normalize_tag_name(name)
    if not normalized:
        raise ValueError("Tag name cannot be empty")
    return normalized


def ensure_tags(db: Session, tag_names: list[str], *, owner_user_id: str) -> list[Tag]:
    normalized_names = sorted({normalize_required_tag_name(name) for name in tag_names})
    if not normalized_names:
        return []

    existing_tags = list(
        db.scalars(
            select(Tag).where(
                Tag.owner_user_id == owner_user_id,
                Tag.name.in_(normalized_names),
            )
        )
    )
    existing_by_name = {tag.name: tag for tag in existing_tags}

    tags: list[Tag] = []
    for name in normalized_names:
        tag = existing_by_name.get(name)
        if tag is None:
            tag = Tag(owner_user_id=owner_user_id, name=name, color=generate_random_tag_color())
            db.add(tag)
            db.flush()
        tags.append(tag)

    return tags


def set_entry_tags(db: Session, entry: Entry, tag_names: list[str]) -> None:
    entry.tags = ensure_tags(db, tag_names, owner_user_id=entry.owner_user_id)


def soft_delete_entry(db: Session, entry: Entry) -> None:
    entry.is_deleted = True
    entry.deleted_at = utc_now()
    db.execute(delete(GroupMember).where(GroupMember.entry_id == entry.id))
    db.flush()


def _normalize_optional_entity_name(name: str | None) -> str | None:
    if name is None:
        return None
    normalized = normalize_entity_name(name)
    return normalized or None


def _normalize_optional_user_name(name: str | None) -> str | None:
    if name is None:
        return None
    normalized = normalize_user_name(name)
    return normalized or None


def _resolve_entity_ref(
    db: Session,
    *,
    ref: EntityRef | EntityRefPatch | None,
    field_name: str,
    owner_user_id: str,
) -> tuple[str | None, str | None]:
    if ref is None:
        return None, None

    normalized_name = _normalize_optional_entity_name(ref.name)

    if ref.entity_id:
        entity = db.scalar(
            select(Entity).where(
                Entity.id == ref.entity_id,
                Entity.owner_user_id == owner_user_id,
            )
        )
        if entity is None:
            raise PolicyViolation.not_found(f"{field_name} entity not found")
        if normalized_name is not None and entity.name.lower() != normalized_name.lower():
            raise PolicyViolation.bad_request(f"{field_name} entity id and name do not match")
        return entity.id, entity.name

    if normalized_name is not None:
        entity = ensure_entity_by_name(
            db,
            normalized_name,
            owner_user_id=owner_user_id,
        )
        return entity.id, entity.name

    return None, None


def _resolve_user_ref(
    db: Session,
    *,
    ref: UserRef | UserRefPatch | None,
    field_name: str,
    principal: RequestPrincipal,
) -> tuple[str | None, str | None]:
    if ref is None:
        return None, None

    normalized_name = _normalize_optional_user_name(ref.name)

    if ref.user_id:
        user = load_user_for_principal(db, user_id=ref.user_id, principal=principal)
        if normalized_name is not None and user.name.lower() != normalized_name.lower():
            raise PolicyViolation.bad_request(f"{field_name} user id and name do not match")
        return user.id, user.name

    if normalized_name is not None:
        user = find_user_by_name(db, normalized_name)
        if user is None:
            raise PolicyViolation.not_found(f"{field_name} user not found")
        ensure_principal_can_assign_user(principal, user_id=user.id)
        return user.id, user.name

    return None, None


def _load_target_groups(
    db: Session,
    *,
    group_ids: list[str],
    principal: RequestPrincipal,
) -> list[str]:
    resolved: list[str] = []
    for group_id in group_ids:
        group = load_group(db, group_id)
        if group is None or group.owner_user_id != principal.user_id:
            raise PolicyViolation.not_found("Group not found.")
        resolved.append(group.id)
    return resolved


def entry_load_options():
    return (selectinload(Entry.tags), selectinload(Entry.group_members))


def _load_entry_for_mutation(
    db: Session,
    *,
    entry_id: str,
    principal: RequestPrincipal,
) -> Entry:
    return load_entry_for_principal(
        db,
        entry_id=entry_id,
        principal=principal,
        stmt=select(Entry).options(*entry_load_options()),
    )


def _validate_category_and_tags(
    db: Session,
    *,
    category: str | None,
    tags: list[str] | None,
    owner_user_id: str,
) -> None:
    """Reject unknown categories and tags that collide with category term names."""
    if category is None and not tags:
        return
    ensure_taxonomy_by_key(db, ENTRY_CATEGORY_TAXONOMY_KEY, owner_user_id=owner_user_id)
    category_names = entry_category_term_names(db, owner_user_id=owner_user_id)
    if category is not None:
        normalized_category = normalize_entry_category_reference(category)
        if normalized_category not in category_names:
            raise PolicyViolation.bad_request(f"Unknown category '{category}'")
    if tags:
        blocked = {normalize_term_name(tag) for tag in tags} & category_names
        if blocked:
            raise PolicyViolation.bad_request(
                "Tags cannot include category names: " + ", ".join(sorted(blocked))
            )


def _assign_entry_category(
    db: Session,
    *,
    entry: Entry,
    category: str | None,
    owner_user_id: str,
) -> None:
    if category is None:
        return
    assign_single_term_by_name(
        db,
        taxonomy_key=ENTRY_CATEGORY_TAXONOMY_KEY,
        subject_type=ENTRY_CATEGORY_SUBJECT_TYPE,
        subject_id=entry.id,
        term_name=normalize_entry_category_reference(category),
        owner_user_id=owner_user_id,
    )


def create_entry_from_command(
    db: Session,
    *,
    command: EntryCreateCommand,
    principal: RequestPrincipal,
) -> Entry:
    if command.owner_ref is None:
        owner_user_id = principal.user_id
        owner_name = principal.user_name
    else:
        owner_user_id, owner_name = _resolve_user_ref(
            db,
            ref=command.owner_ref,
            field_name="owner",
            principal=principal,
        )

    if owner_user_id is None or owner_name is None:  # pragma: no cover - guarded by validation
        raise PolicyViolation.bad_request("Entry owner is required")

    from_entity_id, from_entity_name = _resolve_entity_ref(
        db,
        ref=command.from_ref,
        field_name="from",
        owner_user_id=owner_user_id,
    )
    to_entity_id, to_entity_name = _resolve_entity_ref(
        db,
        ref=command.to_ref,
        field_name="to",
        owner_user_id=owner_user_id,
    )

    entry = Entry(
        kind=command.kind,
        occurred_at=command.occurred_at,
        name=command.name,
        amount_minor=command.amount_minor,
        currency_code=command.currency_code.upper(),
        from_entity_id=from_entity_id,
        to_entity_id=to_entity_id,
        owner_user_id=owner_user_id,
        from_entity=from_entity_name,
        to_entity=to_entity_name,
        owner=owner_name,
        markdown_body=command.markdown_body,
        lifecycle=command.lifecycle,
    )
    db.add(entry)
    db.flush()
    _validate_category_and_tags(
        db, category=command.category, tags=command.tags, owner_user_id=owner_user_id
    )
    set_entry_tags(db, entry, command.tags)
    if command.group_ids:
        _load_target_groups(db, group_ids=command.group_ids, principal=principal)
        set_entry_manual_group_ids(
            db,
            entry=entry,
            group_ids=command.group_ids,
            principal=principal,
        )
    _assign_entry_category(
        db, entry=entry, category=command.category, owner_user_id=owner_user_id
    )

    db.flush()
    return entry


def update_entry_from_command(
    db: Session,
    *,
    entry_id: str,
    command: EntryUpdateCommand,
    principal: RequestPrincipal,
) -> Entry:
    entry = _load_entry_for_mutation(db, entry_id=entry_id, principal=principal)
    update_data = command.model_dump(
        exclude_unset=True,
        exclude={"from_ref", "to_ref", "owner_ref"},
    )

    tags = update_data.pop("tags", None)
    category_value = update_data.pop("category", Ellipsis)
    group_value = update_data.pop("group_ids", Ellipsis)

    if "currency_code" in update_data and update_data["currency_code"] is not None:
        update_data["currency_code"] = update_data["currency_code"].upper()

    resolved_owner_user_id = entry.owner_user_id
    if "owner_ref" in command.model_fields_set:
        owner_user_id, owner_name = _resolve_user_ref(
            db,
            ref=command.owner_ref,
            field_name="owner",
            principal=principal,
        )
        if owner_user_id is None or owner_name is None:
            raise PolicyViolation.bad_request("Entry owner is required")
        resolved_owner_user_id = owner_user_id
        update_data["owner_user_id"] = owner_user_id
        update_data["owner"] = owner_name

    if "from_ref" in command.model_fields_set:
        resolved_id, resolved_name = _resolve_entity_ref(
            db,
            ref=command.from_ref,
            field_name="from",
            owner_user_id=resolved_owner_user_id,
        )
        update_data["from_entity_id"] = resolved_id
        update_data["from_entity"] = resolved_name

    if "to_ref" in command.model_fields_set:
        resolved_id, resolved_name = _resolve_entity_ref(
            db,
            ref=command.to_ref,
            field_name="to",
            owner_user_id=resolved_owner_user_id,
        )
        update_data["to_entity_id"] = resolved_id
        update_data["to_entity"] = resolved_name

    for field, value in update_data.items():
        setattr(entry, field, value)

    category_being_updated = category_value is not Ellipsis
    if tags is not None or category_being_updated:
        _validate_category_and_tags(
            db,
            category=category_value if category_being_updated else None,
            tags=tags,
            owner_user_id=resolved_owner_user_id,
        )
    if tags is not None:
        set_entry_tags(db, entry, tags)
    if category_being_updated:
        assign_single_term_by_name(
            db,
            taxonomy_key=ENTRY_CATEGORY_TAXONOMY_KEY,
            subject_type=ENTRY_CATEGORY_SUBJECT_TYPE,
            subject_id=entry.id,
            term_name=category_value,
            owner_user_id=resolved_owner_user_id,
        )

    if group_value is not Ellipsis:
        set_entry_manual_group_ids(
            db,
            entry=entry,
            group_ids=group_value or [],
            principal=principal,
        )

    db.add(entry)
    db.flush()
    return entry
