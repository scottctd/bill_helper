# CALLING SPEC:
# - Purpose: verify batch approve/reject endpoints and shared batch review orchestration.
# - Inputs: pytest fixtures and helpers that import this module.
# - Outputs: tests asserting batch review HTTP and dependency behavior.
# - Side effects: uses the test database via API client.
from __future__ import annotations

from backend.tests.agent_test_utils import create_thread, patch_model, send_message


def _start_run(client, thread_id: str) -> dict:
    return send_message(client, thread_id, "Batch review test.", wait_for_completion=False)


def _ensure_entities(client) -> None:
    for entity_name in ("Main Checking", "Cafe"):
        entity_response = client.post("/api/v1/entities", json={"name": entity_name})
        entity_response.raise_for_status()


def _create_entry_proposal(client, thread_id: str, run_id: str, *, name: str) -> dict:
    response = client.post(
        f"/api/v1/agent/threads/{thread_id}/proposals",
        headers={"X-Bill-Helper-Agent-Run-Id": run_id},
        json={
            "change_type": "create_entry",
            "payload_json": {
                "kind": "EXPENSE",
                "date": "2026-02-10",
                "name": name,
                "amount_minor": 500,
                "from_entity": "Main Checking",
                "to_entity": "Cafe",
            },
        },
    )
    response.raise_for_status()
    return response.json()


def test_batch_approve_applies_many_entry_proposals_in_one_request(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "Proposals only."})
    _ensure_entities(client)

    thread = create_thread(client)
    run = _start_run(client, thread["id"])

    for index in range(100):
        _create_entry_proposal(client, thread["id"], run["id"], name=f"Batch entry {index}")

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/change-items/batch-approve",
        json={},
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["summary"]["succeeded"] == 100
    assert payload["summary"]["failed"] == 0
    assert payload["summary"]["failed_item_ids"] == []
    assert len(payload["items"]) == 100
    assert all(item["status"] == "APPLIED" for item in payload["items"])


def test_batch_approve_resolves_tag_dependency_in_one_request(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "Proposals only."})
    _ensure_entities(client)

    thread = create_thread(client)
    run = _start_run(client, thread["id"])
    headers = {"X-Bill-Helper-Agent-Run-Id": run["id"]}

    tag_proposal = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers=headers,
        json={
            "change_type": "create_tag",
            "payload_json": {"name": "batch-tag", "type": "daily"},
        },
    )
    tag_proposal.raise_for_status()

    entry_proposal = client.post(
        f"/api/v1/agent/threads/{thread['id']}/proposals",
        headers=headers,
        json={
            "change_type": "create_entry",
            "payload_json": {
                "kind": "EXPENSE",
                "date": "2026-02-10",
                "name": "Tagged lunch",
                "amount_minor": 500,
                "from_entity": "Main Checking",
                "to_entity": "Cafe",
                "tags": ["batch-tag"],
            },
        },
    )
    entry_proposal.raise_for_status()

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/change-items/batch-approve",
        json={},
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["summary"]["succeeded"] == 2
    assert payload["summary"]["failed"] == 0
    assert {item["status"] for item in payload["items"]} == {"APPLIED"}


def test_batch_approve_honors_payload_override(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "Proposals only."})
    _ensure_entities(client)

    thread = create_thread(client)
    run = _start_run(client, thread["id"])
    proposal = _create_entry_proposal(client, thread["id"], run["id"], name="Original name")

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/change-items/batch-approve",
        json={
            "items": [
                {
                    "item_id": proposal["proposal_id"],
                    "payload_override": {
                        "kind": "EXPENSE",
                        "date": "2026-02-10",
                        "name": "Reviewer override",
                        "amount_minor": 500,
                        "from_entity": "Main Checking",
                        "to_entity": "Cafe",
                    },
                }
            ]
        },
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["summary"]["succeeded"] == 1
    assert payload["items"][0]["payload_json"]["name"] == "Reviewer override"

    entries = client.get("/api/v1/entries").json()
    assert any(entry["name"] == "Reviewer override" for entry in entries["items"])


def test_run_scoped_batch_approve_only_touches_target_run(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "Proposals only."})
    _ensure_entities(client)

    thread = create_thread(client)
    first_run = _start_run(client, thread["id"])
    second_run = _start_run(client, thread["id"])

    first_proposal = _create_entry_proposal(client, thread["id"], first_run["id"], name="Run one entry")
    _create_entry_proposal(client, thread["id"], second_run["id"], name="Run two entry")

    response = client.post(
        f"/api/v1/agent/runs/{first_run['id']}/change-items/batch-approve",
        json={},
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["summary"]["succeeded"] == 1
    assert payload["items"][0]["id"] == first_proposal["proposal_id"]

    thread_detail = client.get(f"/api/v1/agent/threads/{thread['id']}").json()
    statuses = {
        item["id"]: item["status"]
        for run in thread_detail["runs"]
        for item in run["change_items"]
    }
    assert statuses[first_proposal["proposal_id"]] == "APPLIED"
    assert any(status == "PENDING_REVIEW" for status in statuses.values())


def test_batch_reject_rejects_all_pending_items(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "Proposals only."})
    _ensure_entities(client)

    thread = create_thread(client)
    run = _start_run(client, thread["id"])
    _create_entry_proposal(client, thread["id"], run["id"], name="Reject me 1")
    _create_entry_proposal(client, thread["id"], run["id"], name="Reject me 2")

    response = client.post(
        f"/api/v1/agent/threads/{thread['id']}/change-items/batch-reject",
        json={},
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["summary"]["succeeded"] == 2
    assert payload["summary"]["failed"] == 0
    assert all(item["status"] == "REJECTED" for item in payload["items"])
