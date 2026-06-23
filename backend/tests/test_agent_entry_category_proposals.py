from __future__ import annotations

from backend.auth.contracts import RequestPrincipal
from backend.database import get_session_maker
from backend.services.agent.apply.entries import apply_update_entry
from backend.services.agent.change_contracts.entries import UpdateEntryPatchPayload, UpdateEntryPayload
from backend.services.users import find_user_by_name
from backend.tests.agent_test_utils import create_thread, patch_model, send_message
from backend.tests.test_entries import create_account


def _ensure_entities(client) -> None:
    for entity_name in ("Main Checking", "Cafe"):
        entity_response = client.post("/api/v1/entities", json={"name": entity_name})
        entity_response.raise_for_status()


def _ensure_grocery_category(client) -> None:
    food_drink = client.post("/api/v1/taxonomies/entry_category/terms", json={"name": "food_drink"})
    food_drink.raise_for_status()
    groceries = client.post(
        "/api/v1/taxonomies/entry_category/terms",
        json={"name": "groceries", "parent_term_id": food_drink.json()["id"], "default_lifecycle": "day_to_day"},
    )
    groceries.raise_for_status()


def test_approve_create_entry_proposal_assigns_category_and_lifecycle(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    _ensure_entities(client)
    _ensure_grocery_category(client)

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Approve categorized entry proposal.")

    create_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers={"X-Bill-Helper-Agent-Run-Id": run["id"]},
        json={
            "change_type": "create_entry",
            "payload_json": {
                "kind": "EXPENSE",
                "date": "2026-03-15",
                "name": "Farm Boy",
                "amount_minor": 1234,
                "from_entity": "Main Checking",
                "to_entity": "Cafe",
                "category": "food_drink/groceries",
                "lifecycle": "day_to_day",
            },
        },
    )
    create_response.raise_for_status()
    proposal_id = create_response.json()["proposal_id"]

    approve_response = client.post(f"/api/v1/agent/change-items/{proposal_id}/approve", json={})
    approve_response.raise_for_status()

    entries = client.get("/api/v1/entries").json()["items"]
    entry = next(item for item in entries if item["name"] == "Farm Boy")
    assert entry["category"] == "food_drink/groceries"
    assert entry["lifecycle"] == "day_to_day"


def test_approve_create_entry_proposal_rejects_unknown_category(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    _ensure_entities(client)

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Reject unknown category on approve.")

    create_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers={"X-Bill-Helper-Agent-Run-Id": run["id"]},
        json={
            "change_type": "create_entry",
            "payload_json": {
                "kind": "EXPENSE",
                "date": "2026-03-15",
                "name": "Mystery Spend",
                "amount_minor": 1234,
                "from_entity": "Main Checking",
                "to_entity": "Cafe",
                "category": "not_a_real_category",
            },
        },
    )
    create_response.raise_for_status()
    proposal_id = create_response.json()["proposal_id"]

    approve_response = client.post(f"/api/v1/agent/change-items/{proposal_id}/approve", json={})
    assert approve_response.status_code == 400
    assert "Unknown category" in approve_response.json()["detail"]


def test_approve_create_entry_proposal_rejects_tag_category_collision(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    _ensure_entities(client)
    _ensure_grocery_category(client)

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Reject tag/category collision on approve.")

    create_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers={"X-Bill-Helper-Agent-Run-Id": run["id"]},
        json={
            "change_type": "create_entry",
            "payload_json": {
                "kind": "EXPENSE",
                "date": "2026-03-15",
                "name": "Farm Boy",
                "amount_minor": 1234,
                "from_entity": "Main Checking",
                "to_entity": "Cafe",
                "category": "food_drink/groceries",
                "tags": ["groceries"],
            },
        },
    )
    create_response.raise_for_status()
    proposal_id = create_response.json()["proposal_id"]

    approve_response = client.post(f"/api/v1/agent/change-items/{proposal_id}/approve", json={})
    assert approve_response.status_code == 400
    assert "Tags cannot include category names" in approve_response.json()["detail"]


def test_approve_batch_import_entry_proposal_assigns_category_and_lifecycle(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    _ensure_entities(client)
    _ensure_grocery_category(client)

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Approve categorized batch import proposal.")

    batch_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals/batch-entries",
        headers={"X-Bill-Helper-Agent-Run-Id": run["id"]},
        json={
            "entries": [
                {
                    "kind": "EXPENSE",
                    "date": "2026-03-15",
                    "name": "Batch Farm Boy",
                    "amount_minor": 1234,
                    "from_entity": "Main Checking",
                    "to_entity": "Cafe",
                    "category": "food_drink/groceries",
                    "lifecycle": "day_to_day",
                }
            ],
        },
    )
    batch_response.raise_for_status()
    proposal_id = batch_response.json()["proposals"][0]["proposal_id"]

    approve_response = client.post(f"/api/v1/agent/change-items/{proposal_id}/approve", json={})
    approve_response.raise_for_status()

    entries = client.get("/api/v1/entries").json()["items"]
    entry = next(item for item in entries if item["name"] == "Batch Farm Boy")
    assert entry["category"] == "food_drink/groceries"
    assert entry["lifecycle"] == "day_to_day"


def test_apply_update_entry_assigns_category_and_lifecycle(client) -> None:
    account_id = create_account(client)
    _ensure_grocery_category(client)
    created = client.post(
        "/api/v1/entries",
        json={
            "from_entity_id": account_id,
            "to_entity": "Cafe",
            "kind": "EXPENSE",
            "occurred_at": "2026-03-15",
            "name": "Coffee",
            "amount_minor": 500,
            "currency_code": "USD",
        },
    )
    created.raise_for_status()
    entry_id = created.json()["id"]

    db = get_session_maker()()
    try:
        admin = find_user_by_name(db, "admin")
        assert admin is not None
        apply_update_entry(
            db,
            UpdateEntryPayload(
                entry_id=entry_id,
                patch=UpdateEntryPatchPayload(
                    category="food_drink/groceries",
                    lifecycle="day_to_day",
                ),
            ),
            principal=RequestPrincipal(user_id=admin.id, user_name=admin.name, is_admin=True),
        )
        db.commit()
    finally:
        db.close()

    updated = client.get(f"/api/v1/entries/{entry_id}").json()
    assert updated["category"] == "food_drink/groceries"
    assert updated["lifecycle"] == "day_to_day"
