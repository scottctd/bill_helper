from __future__ import annotations

import pytest

from backend.auth.contracts import RequestPrincipal
from backend.database import get_session_maker
from backend.services.agent.apply.entries import apply_update_entry
from backend.services.agent.change_contracts.entries import UpdateEntryPatchPayload, UpdateEntryPayload
from backend.services.agent.entry_references import (
    entry_to_public_record,
    find_entries_by_exact_id,
    find_entries_by_public_id_prefix,
)
from backend.models_finance import Entry
from backend.services.users import find_user_by_name
from backend.tests.test_entries import create_account, create_entry


def test_entry_to_public_record_includes_category_and_lifecycle(client) -> None:
    account_id = create_account(client)
    food_drink = client.post("/api/v1/taxonomies/entry_category/terms", json={"name": "food_drink"})
    food_drink.raise_for_status()
    groceries = client.post(
        "/api/v1/taxonomies/entry_category/terms",
        json={
            "name": "groceries",
            "parent_term_id": food_drink.json()["id"],
            "default_lifecycle": "day_to_day",
        },
    )
    groceries.raise_for_status()

    created = client.post(
        "/api/v1/entries",
        json={
            "from_entity_id": account_id,
            "to_entity": "Farm Boy",
            "kind": "EXPENSE",
            "occurred_at": "2026-03-15",
            "name": "Farm Boy",
            "amount_minor": 1234,
            "currency_code": "USD",
            "category": "food_drink/groceries",
            "lifecycle": "day_to_day",
            "tags": ["grocery"],
        },
    )
    created.raise_for_status()

    db = get_session_maker()()
    try:
        entry = db.get(Entry, created.json()["id"])
        assert entry is not None
        record = entry_to_public_record(entry, db=db)
        assert record["category"] == "food_drink/groceries"
        assert record["lifecycle"] == "day_to_day"
        assert record["tags"] == ["grocery"]
    finally:
        db.close()


def test_entry_reference_helpers_split_exact_and_prefix_lookup(client) -> None:
    account_id = create_account(client)
    entry = create_entry(client, account_id, "Coffee")
    public_id = entry["id"][:8]

    db = get_session_maker()()
    try:
        assert find_entries_by_exact_id(db, public_id) == []
        prefix_matches = find_entries_by_public_id_prefix(db, public_id)
        assert [match.id for match in prefix_matches] == [entry["id"]]
        exact_matches = find_entries_by_exact_id(db, entry["id"])
        assert [match.id for match in exact_matches] == [entry["id"]]
    finally:
        db.close()


def test_entry_reference_helpers_scope_matches_by_principal(client, auth_headers) -> None:
    admin_account_id = create_account(client, name="Admin Checking")
    admin_entry = create_entry(client, admin_account_id, "Admin Coffee")

    alice_headers = auth_headers("alice")
    alice_account_id = create_account(client, name="Alice Checking", headers=alice_headers)
    alice_entry = create_entry(client, alice_account_id, "Alice Coffee", headers=alice_headers)

    db = get_session_maker()()
    try:
        alice = find_user_by_name(db, "alice")
        assert alice is not None

        assert find_entries_by_exact_id(
            db,
            admin_entry["id"],
            principal_user_id=alice.id,
            is_admin=False,
        ) == []

        alice_matches = find_entries_by_exact_id(
            db,
            alice_entry["id"],
            principal_user_id=alice.id,
            is_admin=False,
        )
        assert [match.id for match in alice_matches] == [alice_entry["id"]]

        prefix_matches = find_entries_by_public_id_prefix(
            db,
            admin_entry["id"][:8],
            principal_user_id=alice.id,
            is_admin=False,
        )
        assert prefix_matches == []
    finally:
        db.close()


def test_apply_update_entry_uses_owner_scope(client) -> None:
    admin_account_id = create_account(client, name="Admin Checking")
    admin_entry = create_entry(client, admin_account_id, "Admin Coffee")

    db = get_session_maker()()
    try:
        with pytest.raises(ValueError, match="Entry id did not match any entry"):
            apply_update_entry(
                db,
                UpdateEntryPayload(
                    entry_id=admin_entry["id"],
                    patch=UpdateEntryPatchPayload(name="Hidden update"),
                ),
                principal=RequestPrincipal(user_id="alice-user", user_name="alice", is_admin=False),
            )
    finally:
        db.close()
