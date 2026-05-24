from __future__ import annotations

from backend.database import get_session_maker
from backend.services.agent.external_session import external_session_system_message
from backend.services.agent.message_history import build_llm_messages
from backend.tests.agent_test_utils import create_thread, patch_model, send_message


def test_build_llm_messages_includes_external_session_marker(client) -> None:
    create_response = client.post("/api/v1/agent/sessions", json={"title": "External receipts"})
    create_response.raise_for_status()
    session_id = create_response.json()["id"]

    db = get_session_maker()()
    try:
        messages = build_llm_messages(db, session_id)
    finally:
        db.close()

    system_contents = [message["content"] for message in messages if message["role"] == "system"]
    assert external_session_system_message() in system_contents


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
