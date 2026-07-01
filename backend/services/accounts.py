# CALLING SPEC:
# - Purpose: account create/update/delete workflows and account read-model assembly.
# - Inputs: account rows, principal scope, and service-owned write commands.
# - Outputs: account CRUD helpers, balance reads, and list/read builders.
# - Side effects: database persistence, validation, and read queries.
from __future__ import annotations

from datetime import date

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.models_finance import Account, Entity, Entry, User
from backend.schemas_finance import AccountRead
from backend.services.account_balances import compute_account_balance, compute_account_balances
from backend.services.access_scope import ensure_principal_can_assign_user
from backend.services.crud_policy import (
    PolicyViolation,
    assert_unique_name,
    normalize_required_name,
)
from backend.services.entities import (
    clear_entity_category,
    detach_entity_references_preserve_labels,
    find_entity_by_name,
    rename_entity_and_sync_entry_labels,
    set_entity_category,
)
from backend.services.finance_contracts import AccountCreateCommand, AccountPatch
from backend.validation.finance_names import normalize_entity_name


def list_accounts_for_principal(db: Session, *, principal: RequestPrincipal) -> list[AccountRead]:
    from backend.services.access_scope import account_owner_filter

    accounts = list(
        db.scalars(
            select(Account)
            .join(Entity, Entity.id == Account.id)
            .where(account_owner_filter(principal))
            .options(selectinload(Account.entity))
            .order_by(Entity.name.asc(), Account.created_at.asc())
        )
    )
    return build_account_reads(db, accounts)


def build_account_read(
    db: Session,
    account: Account,
    *,
    as_of: date | None = None,
) -> AccountRead:
    effective_as_of = as_of or date.today()
    balance = compute_account_balance(db, account_id=account.id, as_of=effective_as_of)
    return AccountRead(
        id=account.id,
        owner_user_id=account.owner_user_id,
        name=account.name,
        markdown_body=account.markdown_body,
        currency_code=account.currency_code,
        is_active=account.is_active,
        created_at=account.created_at,
        updated_at=account.updated_at,
        balance_minor=balance.balance_minor,
        balance_as_of=balance.balance_as_of,
        latest_snapshot_at=balance.latest_snapshot_at,
    )


def build_account_reads(
    db: Session,
    accounts: list[Account],
    *,
    as_of: date | None = None,
) -> list[AccountRead]:
    effective_as_of = as_of or date.today()
    balances = compute_account_balances(
        db,
        account_ids=[account.id for account in accounts],
        as_of=effective_as_of,
    )
    return [
        AccountRead(
            id=account.id,
            owner_user_id=account.owner_user_id,
            name=account.name,
            markdown_body=account.markdown_body,
            currency_code=account.currency_code,
            is_active=account.is_active,
            created_at=account.created_at,
            updated_at=account.updated_at,
            balance_minor=balances[account.id].balance_minor,
            balance_as_of=balances[account.id].balance_as_of,
            latest_snapshot_at=balances[account.id].latest_snapshot_at,
        )
        for account in accounts
    ]


def validate_account_owner_user_id(
    db: Session,
    *,
    owner_user_id: str,
) -> str:
    user = db.get(User, owner_user_id)
    if user is None:
        raise PolicyViolation.not_found("Owner user not found")
    return owner_user_id


def resolve_owner_user_id(
    db: Session,
    *,
    owner_user_id: str | None,
    principal: RequestPrincipal,
) -> str:
    if owner_user_id is not None:
        validated_owner_user_id = validate_account_owner_user_id(db, owner_user_id=owner_user_id)
        ensure_principal_can_assign_user(principal, user_id=validated_owner_user_id)
        return validated_owner_user_id
    return principal.user_id


def find_account_by_name(
    db: Session,
    name: str,
    *,
    owner_user_id: str,
) -> Account | None:
    normalized_name = normalize_entity_name(name)
    if not normalized_name:
        return None
    return db.scalar(
        select(Account)
        .join(Entity, Entity.id == Account.id)
        .options(selectinload(Account.entity))
        .where(
            Account.owner_user_id == owner_user_id,
            func.lower(Entity.name) == normalized_name.lower(),
        )
    )


def create_account_root(
    db: Session,
    *,
    name: str,
    owner_user_id: str,
    markdown_body: str | None,
    currency_code: str,
    is_active: bool,
) -> Account:
    normalized_name = normalize_required_name(
        name,
        normalizer=normalize_entity_name,
        empty_detail="Account name cannot be empty",
    )

    validated_owner_user_id = validate_account_owner_user_id(db, owner_user_id=owner_user_id)
    existing_entity = find_entity_by_name(
        db,
        normalized_name,
        owner_user_id=validated_owner_user_id,
    )
    assert_unique_name(
        existing_id=existing_entity.id if existing_entity is not None else None,
        current_id=None,
        conflict_detail="Entity name already exists",
    )

    entity = Entity(owner_user_id=validated_owner_user_id, name=normalized_name, category=None)
    db.add(entity)
    db.flush()
    set_entity_category(db, entity, "account")

    account = Account(
        id=entity.id,
        owner_user_id=validated_owner_user_id,
        markdown_body=markdown_body,
        currency_code=currency_code.upper(),
        is_active=is_active,
    )
    db.add(account)
    db.flush()
    db.refresh(account, attribute_names=["entity"])
    return account


def update_account_root(
    db: Session,
    *,
    account: Account,
    patch: AccountPatch,
) -> Account:
    if patch.includes("name") and patch.name is not None:
        if account.entity is None:
            raise PolicyViolation.not_found("Account entity not found")
        existing_entity = find_entity_by_name(
            db,
            patch.name,
            owner_user_id=account.owner_user_id,
        )
        assert_unique_name(
            existing_id=existing_entity.id if existing_entity is not None else None,
            current_id=account.id,
            conflict_detail="Entity name already exists",
        )
        rename_entity_and_sync_entry_labels(
            db,
            entity=account.entity,
            raw_name=patch.name,
        )

    if patch.includes("owner_user_id") and patch.owner_user_id is not None:
        new_owner_user_id = validate_account_owner_user_id(
            db,
            owner_user_id=patch.owner_user_id,
        )
        owner_user = db.get(User, new_owner_user_id)
        if owner_user is None:  # pragma: no cover - guarded by validation
            raise PolicyViolation.not_found("Owner user not found")
        if account.entity is None:
            raise PolicyViolation.not_found("Account entity not found")

        existing_entity = find_entity_by_name(
            db,
            account.entity.name,
            owner_user_id=new_owner_user_id,
        )
        assert_unique_name(
            existing_id=existing_entity.id if existing_entity is not None else None,
            current_id=account.id,
            conflict_detail="Entity name already exists",
        )
        account.owner_user_id = new_owner_user_id
        account.entity.owner_user_id = new_owner_user_id
        db.execute(
            update(Entry)
            .where(
                or_(
                    Entry.from_entity_id == account.id,
                    Entry.to_entity_id == account.id,
                )
            )
            .values(owner_user_id=new_owner_user_id, owner=owner_user.name)
        )

    if patch.includes("markdown_body"):
        account.markdown_body = patch.markdown_body
    if patch.includes("currency_code") and patch.currency_code is not None:
        account.currency_code = patch.currency_code
    if patch.includes("is_active") and patch.is_active is not None:
        account.is_active = patch.is_active

    db.add(account)
    db.flush()
    return account


def create_account(
    db: Session,
    *,
    command: AccountCreateCommand,
    principal: RequestPrincipal,
) -> Account:
    return create_account_root(
        db,
        name=command.name,
        owner_user_id=resolve_owner_user_id(
            db,
            owner_user_id=command.owner_user_id,
            principal=principal,
        ),
        markdown_body=command.markdown_body,
        currency_code=command.currency_code,
        is_active=command.is_active,
    )


def update_account(
    db: Session,
    *,
    account: Account,
    patch: AccountPatch,
    principal: RequestPrincipal,
) -> Account:
    update_data = patch.model_dump(exclude_unset=True)
    if "owner_user_id" in update_data:
        if update_data["owner_user_id"] is None:
            raise PolicyViolation.bad_request("Account owner is required")
        update_data["owner_user_id"] = resolve_owner_user_id(
            db,
            owner_user_id=update_data["owner_user_id"],
            principal=principal,
        )

    resolved_patch = AccountPatch.model_validate(update_data)
    return update_account_root(
        db,
        account=account,
        patch=resolved_patch,
    )


def delete_account_and_entity_root(db: Session, *, account: Account) -> None:
    if account.entity is None:
        raise ValueError("Account entity not found")

    detach_entity_references_preserve_labels(db, entity=account.entity)
    clear_entity_category(db, account.entity)
    db.delete(account)
    db.delete(account.entity)
    db.flush()
