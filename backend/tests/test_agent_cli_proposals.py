from __future__ import annotations

from backend.tests.agent_test_utils import create_thread, patch_model, send_message


def _ensure_entities(client) -> None:
    for entity_name in ("Main Checking", "Cafe"):
        entity_response = client.post("/api/v1/entities", json={"name": entity_name})
        entity_response.raise_for_status()


def _run_headers(run_id: str) -> dict[str, str]:
    return {"X-Bill-Helper-Agent-Run-Id": run_id}


def test_thread_proposal_routes_create_get_and_list(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for proposal context.")

    create_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers=_run_headers(run["id"]),
        json={
            "change_type": "create_tag",
            "payload_json": {
                "name": "food",
                "type": "expense",
            },
        },
    )
    create_response.raise_for_status()
    created = create_response.json()
    assert created["proposal_type"] == "tag"
    assert created["change_action"] == "create"
    assert created["payload"]["name"] == "food"

    get_response = client.get(
        f"/api/v1/agent/threads/{thread['id']}/proposals/{created['proposal_id']}",
        headers=_run_headers(run["id"]),
    )
    get_response.raise_for_status()
    assert get_response.json()["proposal_id"] == created["proposal_id"]

    short_id_response = client.get(
        f"/api/v1/agent/threads/{thread['id']}/proposals/{created['proposal_short_id']}",
        headers=_run_headers(run["id"]),
    )
    assert short_id_response.status_code == 404
    assert short_id_response.json()["detail"] == "Proposal not found."

    list_response = client.get(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers=_run_headers(run["id"]),
        params={"proposal_type": "tag", "limit": 10},
    )
    list_response.raise_for_status()
    listed = list_response.json()
    assert listed["returned_count"] == 1
    assert listed["proposals"][0]["proposal_id"] == created["proposal_id"]


def test_thread_proposal_routes_allow_external_session_without_run_header(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for proposal context.")
    assert run["status"] == "completed"

    response = client.get(f"/api/v1/agent/threads/{thread['id']}/proposals")

    response.raise_for_status()
    assert response.json()["returned_count"] == 0


def test_thread_proposal_routes_update_and_remove_pending_proposal(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for proposal edit context.")

    create_response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers=_run_headers(run["id"]),
        json={
            "change_type": "create_tag",
            "payload_json": {
                "name": "food",
                "type": "expense",
            },
        },
    )
    create_response.raise_for_status()
    created = create_response.json()

    update_response = client.patch(
        f"/api/v1/agent/threads/{thread['id']}/proposals/{created['proposal_id']}",
        headers=_run_headers(run["id"]),
        json={"patch_map": {"name": "groceries"}},
    )
    update_response.raise_for_status()
    updated = update_response.json()
    assert updated["payload"]["name"] == "groceries"
    assert updated["status"] == "PENDING_REVIEW"

    delete_response = client.delete(
        f"/api/v1/agent/threads/{thread['id']}/proposals/{created['proposal_id']}",
        headers=_run_headers(run["id"]),
    )
    assert delete_response.status_code == 204

    get_response = client.get(
        f"/api/v1/agent/threads/{thread['id']}/proposals/{created['proposal_id']}",
        headers=_run_headers(run["id"]),
    )
    assert get_response.status_code == 404


def test_thread_proposal_routes_create_batch_entries(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    _ensure_entities(client)

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for batch entry proposals.")

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals/batch-entries",
        headers=_run_headers(run["id"]),
        json={
            "entries": [
                {
                    "kind": "EXPENSE",
                    "date": "2026-03-15",
                    "name": "Farm Boy",
                    "amount_minor": 1234,
                    "from_entity": "Main Checking",
                    "to_entity": "Cafe",
                    "tags": ["grocery"],
                },
                {
                    "kind": "EXPENSE",
                    "date": "2026-03-16",
                    "name": "Coffee",
                    "amount_minor": 450,
                    "from_entity": "Main Checking",
                    "to_entity": "Cafe",
                },
            ],
        },
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["returned_count"] == 2
    assert payload["total_available"] == 2
    assert len(payload["proposals"]) == 2
    assert all(item["change_type"] == "create_entry" for item in payload["proposals"])
    assert payload["proposals"][0]["payload"]["name"] == "Farm Boy"
    assert payload["proposals"][1]["payload"]["name"] == "Coffee"


def test_thread_proposal_routes_reject_invalid_batch_entries(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    _ensure_entities(client)

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for batch validation.")

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals/batch-entries",
        headers=_run_headers(run["id"]),
        json={
            "entries": [
                {
                    "kind": "EXPENSE",
                    "date": "2026-03-15",
                    "name": "Farm Boy",
                    "amount_minor": 1234,
                    "from_entity": "Main Checking",
                    "to_entity": "Missing Entity",
                },
            ],
        },
    )
    assert response.status_code == 400
    assert "entries[0]" in response.json()["detail"]


def test_thread_proposal_routes_reject_empty_batch_entries(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for empty batch validation.")

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals/batch-entries",
        headers=_run_headers(run["id"]),
        json={"entries": []},
    )
    assert response.status_code == 422
