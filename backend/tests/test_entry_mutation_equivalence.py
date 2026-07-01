from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database import get_session_maker
from backend.models_finance import Entry, GroupMember
from backend.services.taxonomy import get_entry_category_path_map
from backend.tests.agent_test_utils import create_thread, patch_model, send_message
from backend.tests.test_entries import create_account


ENTRY_ROW_FIELDS = (
    "kind",
    "occurred_at",
    "name",
    "amount_minor",
    "currency_code",
    "from_entity_id",
    "to_entity_id",
    "owner_user_id",
    "from_entity",
    "to_entity",
    "owner",
    "markdown_body",
    "lifecycle",
)


def _entry_domain_snapshot(db, entry_id: str) -> dict[str, object]:
    entry = db.scalar(
        select(Entry)
        .where(Entry.id == entry_id)
        .options(selectinload(Entry.tags))
    )
    assert entry is not None
    category_paths = get_entry_category_path_map(db, entry_ids=[entry.id])
    group_ids = sorted(
        db.scalars(select(GroupMember.group_id).where(GroupMember.entry_id == entry.id))
    )
    return {
        **{field: getattr(entry, field) for field in ENTRY_ROW_FIELDS},
        "tags": sorted(tag.name for tag in entry.tags),
        "category": category_paths.get(entry.id),
        "group_ids": group_ids,
    }


def test_http_create_and_agent_apply_create_produce_equivalent_entries(
    client,
    monkeypatch,
) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    account_id = create_account(client, "Equivalence Checking")

    cafe_response = client.post("/api/v1/entities", json={"name": "Equivalence Cafe"})
    cafe_response.raise_for_status()

    shared = {
        "kind": "EXPENSE",
        "occurred_at": "2026-04-10",
        "name": "Equivalence Entry",
        "amount_minor": 2500,
        "currency_code": "USD",
        "markdown_body": "Shared notes",
        "tags": ["coffee", "work"],
        "lifecycle": "day_to_day",
    }
    http_response = client.post(
        "/api/v1/entries",
        json={
            **shared,
            "from_entity_id": account_id,
            "to_entity": "Equivalence Cafe",
        },
    )
    http_response.raise_for_status()
    http_entry_id = http_response.json()["id"]

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create equivalent agent entry.")
    proposal_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers={"X-Bill-Helper-Agent-Run-Id": run["id"]},
        json={
            "change_type": "create_entry",
            "payload_json": {
                "kind": shared["kind"],
                "date": shared["occurred_at"],
                "name": shared["name"],
                "amount_minor": shared["amount_minor"],
                "currency_code": shared["currency_code"],
                "from_entity": "Equivalence Checking",
                "to_entity": "Equivalence Cafe",
                "markdown_notes": shared["markdown_body"],
                "tags": shared["tags"],
                "lifecycle": shared["lifecycle"],
            },
        },
    )
    proposal_response.raise_for_status()
    proposal_id = proposal_response.json()["proposal_id"]

    approve_response = client.post(
        f"/api/v1/agent/change-items/{proposal_id}/approve",
        json={},
    )
    approve_response.raise_for_status()

    entries = client.get("/api/v1/entries").json()["items"]
    agent_entry_id = next(item["id"] for item in entries if item["id"] != http_entry_id)

    db = get_session_maker()()
    try:
        http_snapshot = _entry_domain_snapshot(db, http_entry_id)
        agent_snapshot = _entry_domain_snapshot(db, agent_entry_id)
        assert http_snapshot == agent_snapshot
        assert http_snapshot["occurred_at"] == date(2026, 4, 10)
    finally:
        db.close()
