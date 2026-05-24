from __future__ import annotations


def test_agent_sessions_create_update_and_text_source_dedupe(client) -> None:
    create_response = client.post(
        "/api/v1/agent/sessions",
        json={"title": "March statements", "summary": "Initial summary."},
    )
    create_response.raise_for_status()
    session = create_response.json()

    update_response = client.patch(
        f"/api/v1/agent/sessions/{session['id']}",
        json={"summary": "Updated summary."},
    )
    update_response.raise_for_status()
    assert update_response.json()["summary"] == "Updated summary."

    source_payload = {
        "text": "Statement balance: 1234.56",
        "filename": "statement.txt",
        "note": "raw statement text",
    }
    first_source_response = client.post(
        f"/api/v1/agent/sessions/{session['id']}/sources/text",
        json=source_payload,
    )
    first_source_response.raise_for_status()
    first_source = first_source_response.json()

    second_source_response = client.post(
        f"/api/v1/agent/sessions/{session['id']}/sources/text",
        json=source_payload,
    )
    second_source_response.raise_for_status()
    second_source = second_source_response.json()

    assert second_source["source_id"] == first_source["source_id"]
    assert second_source["id"] == first_source["id"]

    sources_response = client.get(f"/api/v1/agent/sessions/{session['id']}/sources")
    sources_response.raise_for_status()
    assert [source["source_id"] for source in sources_response.json()["sources"]] == [first_source["source_id"]]


def test_agent_session_proposals_can_be_created_without_run_header(client) -> None:
    create_response = client.post("/api/v1/agent/sessions", json={"title": "External agent"})
    create_response.raise_for_status()
    session = create_response.json()

    proposal_response = client.post(
        f"/api/v1/agent/threads/{session['id']}/proposals",
        json={
            "change_type": "create_tag",
            "payload_json": {
                "name": "statement_review",
                "type": "expense",
            },
        },
    )
    proposal_response.raise_for_status()
    proposal = proposal_response.json()

    assert proposal["change_type"] == "create_tag"
    assert proposal["run_id"]

    list_response = client.get(f"/api/v1/agent/threads/{session['id']}/proposals")
    list_response.raise_for_status()
    assert list_response.json()["total_available"] == 1


def test_external_session_thread_exposes_marker_and_flag(client) -> None:
    create_response = client.post("/api/v1/agent/sessions", json={"title": "External receipts"})
    create_response.raise_for_status()
    session = create_response.json()

    detail_response = client.get(f"/api/v1/agent/threads/{session['id']}")
    detail_response.raise_for_status()
    detail = detail_response.json()

    assert detail["thread"]["initiated_by_external_agent"] is True
    assert len(detail["messages"]) == 1
    assert detail["messages"][0]["role"] == "system"
    assert detail["messages"][0]["content_markdown"].startswith("This session was started by an external agent")

    list_response = client.get("/api/v1/agent/threads")
    list_response.raise_for_status()
    listed = next(item for item in list_response.json() if item["id"] == session["id"])
    assert listed["initiated_by_external_agent"] is True
    assert listed["last_message_preview"] is None
