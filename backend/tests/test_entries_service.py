from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from backend.auth.contracts import RequestPrincipal
from backend.database import get_session_maker
from backend.enums_finance import EntryKind, GroupSource
from backend.models_finance import Account, Entity, Group, GroupMember, User
from backend.services.crud_policy import PolicyViolation
from backend.services.accounts import create_account_root
from backend.services.entries import (
    EntityRef,
    UserRefPatch,
    UserRef,
    EntryCreateCommand,
    EntryUpdateCommand,
    create_entry_from_command,
    update_entry_from_command,
)
from backend.services.entities import read_entity_category
from backend.services.passwords import hash_password


def _create_user(db, name: str) -> User:
    existing = db.query(User).filter(User.name == name).one_or_none()
    if existing is not None:
        return existing

    user = User(
        name=name,
        password_hash=hash_password(f"{name}-password"),
        is_admin=name.lower() == "admin",
    )
    db.add(user)
    db.flush()
    return user


def _create_account(db, *, name: str, owner_user_id: str) -> Account:
    entity = Entity(name=name, owner_user_id=owner_user_id)
    db.add(entity)
    db.flush()

    account = Account(
        id=entity.id,
        owner_user_id=owner_user_id,
        currency_code="USD",
        is_active=True,
    )
    db.add(account)
    db.flush()
    return account


def _create_group(db, *, name: str, owner_user_id: str) -> Group:
    group = Group(
        owner_user_id=owner_user_id,
        name=name,
        source=GroupSource.MANUAL,
    )
    db.add(group)
    db.flush()
    return group


def test_create_entry_from_command_assigns_tags_and_manual_groups() -> None:
    make_session = get_session_maker()
    db = make_session()
    try:
        admin = _create_user(db, "admin")
        account = _create_account(db, name="Checking", owner_user_id=admin.id)
        group = _create_group(db, name="Bills", owner_user_id=admin.id)
        principal = RequestPrincipal(user_id=admin.id, user_name=admin.name, is_admin=True)

        entry = create_entry_from_command(
            db,
            command=EntryCreateCommand(
                kind=EntryKind.EXPENSE,
                occurred_at=date(2026, 1, 1),
                name="Hydro Bill",
                amount_minor=1234,
                currency_code="usd",
                from_ref=EntityRef(entity_id=account.id, name="Checking"),
                owner_ref=UserRef(user_id=admin.id),
                tags=["Food"],
                group_ids=[group.id],
            ),
            principal=principal,
        )
        db.commit()

        assert entry.id is not None
        assert entry.owner_user_id == admin.id
        assert entry.from_entity_id == account.id
        assert entry.from_entity == "Checking"
        assert [tag.name for tag in entry.tags] == ["food"]
        memberships = list(
            db.scalars(
                select(GroupMember).where(
                    GroupMember.group_id == group.id,
                    GroupMember.entry_id == entry.id,
                )
            )
        )
        assert len(memberships) == 1
        assert memberships[0].override is None
    finally:
        db.close()


def test_update_entry_from_command_uses_policy_violation_for_cross_principal_owner_name() -> None:
    make_session = get_session_maker()
    db = make_session()
    try:
        admin = _create_user(db, "admin")
        alice = _create_user(db, "alice")
        account = _create_account(db, name="Alice Checking", owner_user_id=alice.id)
        principal = RequestPrincipal(user_id=alice.id, user_name=alice.name, is_admin=False)

        entry = create_entry_from_command(
            db,
            command=EntryCreateCommand(
                kind=EntryKind.EXPENSE,
                occurred_at=date(2026, 1, 2),
                name="Coffee",
                amount_minor=600,
                currency_code="USD",
                from_ref=EntityRef(entity_id=account.id),
                to_ref=EntityRef(name="Counterparty"),
                tags=["food"],
            ),
            principal=principal,
        )
        db.commit()

        with pytest.raises(PolicyViolation) as exc_info:
            update_entry_from_command(
                db,
                entry_id=entry.id,
                command=EntryUpdateCommand(owner_ref=UserRefPatch(name=admin.name)),
                principal=principal,
            )

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Cannot assign resources to a different user."
    finally:
        db.close()


def test_create_account_root_marks_linked_entity_category_as_account() -> None:
    make_session = get_session_maker()
    db = make_session()
    try:
        admin = _create_user(db, "admin")

        account = create_account_root(
            db,
            name="Checking",
            owner_user_id=admin.id,
            markdown_body=None,
            currency_code="USD",
            is_active=True,
        )
        db.commit()

        assert account.entity is not None
        assert read_entity_category(db, account.entity) == "account"
    finally:
        db.close()
