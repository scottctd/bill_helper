from __future__ import annotations

from backend.services.agent.external_session import external_session_system_message
from backend.tests.agent_test_utils import create_thread, patch_model, send_message


def test_external_session_marker_is_seeded_on_create(client) -> None:
    create_response = client.post("/api/v1/agent/sessions", json={"title": "External receipts"})
    create_response.raise_for_status()
    session_id = create_response.json()["id"]

    detail_response = client.get(f"/api/v1/agent/threads/{session_id}")
    detail_response.raise_for_status()
    detail = detail_response.json()
    assert detail["thread"]["initiated_by_external_agent"] is True


def test_hosted_thread_is_not_marked_external(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    thread = create_thread(client)

    detail_response = client.get(f"/api/v1/agent/threads/{thread['id']}")
    detail_response.raise_for_status()
    assert detail_response.json()["thread"]["initiated_by_external_agent"] is False

    send_message(client, thread["id"], "Hello")

    detail_response = client.get(f"/api/v1/agent/threads/{thread['id']}")
    detail_response.raise_for_status()
    assert detail_response.json()["thread"]["initiated_by_external_agent"] is False


def test_external_session_system_message_text_is_stable() -> None:
    assert external_session_system_message().startswith(
        "This session was started by an external agent"
    )
