# CALLING SPEC:
# - Purpose: verify import workflow API, preflight, and job lifecycle behavior.
# - Inputs: pytest client fixture and monkeypatched agent execution.
# - Outputs: assertions on import routes and thread list filtering.
# - Side effects: uses isolated test database via conftest.
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from sqlalchemy import select

from backend.database import open_session
from backend.enums_agent import AgentMessageRole, AgentRunStatus
from backend.enums_import import ImportJobStatus, ImportPreflightSuggestedAction, ImportTaskStatus
from backend.models_agent import AgentMessage, AgentRun
from backend.models_import import ImportTask
from backend.services.import_workflow.scheduler import notify_agent_run_terminal, reset_import_scheduler_for_tests
from backend.tests.agent_test_utils import build_pdf_bytes


@pytest.fixture(autouse=True)
def _import_test_data_dir(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("BILL_HELPER_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _reset_scheduler():
    reset_import_scheduler_for_tests()
    yield
    reset_import_scheduler_for_tests()


def _upload_pdf(client: TestClient, *, filename: str, text: str) -> dict:
    response = client.post(
        "/api/v1/agent/draft-attachments",
        files={"file": (filename, build_pdf_bytes([text]), "application/pdf")},
    )
    response.raise_for_status()
    return response.json()


def test_import_preflight_marks_new_file(client: TestClient):
    attachment = _upload_pdf(client, filename="new-statement.pdf", text="Total 10.00")
    response = client.post(
        "/api/v1/import/preflight",
        json={"source_attachment_ids": [attachment["id"]]},
    )
    response.raise_for_status()
    payload = response.json()
    assert len(payload["files"]) == 1
    row = payload["files"][0]
    assert row["filename"] == "new-statement.pdf"
    assert row["previously_imported"] is False
    assert row["suggested_action"] == ImportPreflightSuggestedAction.IMPORT.value


def test_import_preflight_detects_prior_import_by_sha256(client: TestClient, monkeypatch):
    monkeypatch.setattr("backend.routers.import_jobs.start_import_job", lambda job_id: None)

    pdf_bytes = build_pdf_bytes(["Same content"])
    first_response = client.post(
        "/api/v1/agent/draft-attachments",
        files={"file": ("statement-a.pdf", pdf_bytes, "application/pdf")},
    )
    first_response.raise_for_status()
    first = first_response.json()

    create_response = client.post(
        "/api/v1/import/jobs",
        json={
            "instructions": "Import this file.",
            "source_attachment_ids": [first["id"]],
        },
    )
    create_response.raise_for_status()
    task_payload = create_response.json()["tasks"][0]

    with open_session() as db:
        task = db.get(ImportTask, task_payload["id"])
        assert task is not None
        task.status = ImportTaskStatus.COMPLETED
        db.add(task)
        db.commit()

    renamed_response = client.post(
        "/api/v1/agent/draft-attachments",
        files={"file": ("statement-renamed.pdf", pdf_bytes, "application/pdf")},
    )
    renamed_response.raise_for_status()
    renamed = renamed_response.json()
    preflight = client.post(
        "/api/v1/import/preflight",
        json={"source_attachment_ids": [renamed["id"]]},
    )
    preflight.raise_for_status()
    row = preflight.json()["files"][0]
    assert row["previously_imported"] is True
    assert len(row["prior_imports"]) >= 1
    assert row["prior_imports"][0]["task_id"] == task_payload["id"]


def test_create_import_job_creates_tasks(client: TestClient, monkeypatch):
    monkeypatch.setattr("backend.routers.import_jobs.start_import_job", lambda job_id: None)

    attachments = [
        _upload_pdf(client, filename="one.pdf", text="One"),
        _upload_pdf(client, filename="two.pdf", text="Two"),
    ]
    response = client.post(
        "/api/v1/import/jobs",
        json={
            "title": "Batch import",
            "instructions": "Import entries from each attachment.",
            "source_attachment_ids": [item["id"] for item in attachments],
            "concurrency": 2,
        },
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["title"] == "Batch import"
    assert payload["total_tasks"] == 2
    assert payload["concurrency"] == 2
    assert len(payload["tasks"]) == 2
    assert payload["tasks"][0]["source_label"] == "one.pdf"
    assert payload["tasks"][1]["source_label"] == "two.pdf"


def test_import_threads_are_hidden_from_agent_list(client: TestClient, monkeypatch):
    monkeypatch.setattr("backend.routers.import_jobs.start_import_job", lambda job_id: None)
    attachment = _upload_pdf(client, filename="hidden-thread.pdf", text="Hidden")
    create_response = client.post(
        "/api/v1/import/jobs",
        json={"instructions": "Import", "source_attachment_ids": [attachment["id"]]},
    )
    create_response.raise_for_status()
    thread_id = create_response.json()["tasks"][0]["thread_id"]

    threads = client.get("/api/v1/agent/threads")
    threads.raise_for_status()
    assert thread_id not in {item["id"] for item in threads.json()}


def test_scheduler_marks_task_complete_on_run_terminal(client: TestClient, monkeypatch):
    created_runs: list[str] = []

    async def fake_create_user_message_and_start_run(**kwargs):
        db = kwargs["db"]
        thread_id = kwargs["thread_id"]
        message = AgentMessage(
            thread_id=thread_id,
            role=AgentMessageRole.USER,
            content_markdown=kwargs["content"],
        )
        db.add(message)
        db.flush()
        run = AgentRun(
            thread_id=thread_id,
            user_message_id=message.id,
            status=AgentRunStatus.RUNNING,
            model_name="test-model",
        )
        db.add(run)
        db.flush()
        created_runs.append(run.id)
        return run

    monkeypatch.setattr(
        "backend.services.import_workflow.scheduler.create_user_message_and_start_run",
        fake_create_user_message_and_start_run,
    )
    monkeypatch.setattr(
        "backend.services.import_workflow.scheduler.run_agent_in_background",
        lambda run_id, session_factory=None: None,
    )
    monkeypatch.setattr(
        "backend.services.agent.execution.ensure_agent_available",
        lambda db, model_name=None: None,
    )

    attachment = _upload_pdf(client, filename="scheduler.pdf", text="Scheduler")
    create_response = client.post(
        "/api/v1/import/jobs",
        json={"instructions": "Import", "source_attachment_ids": [attachment["id"]]},
    )
    create_response.raise_for_status()
    job_id = create_response.json()["id"]

    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and not created_runs:
        time.sleep(0.05)
    assert created_runs

    deadline = time.monotonic() + 3.0
    run_visible = False
    while time.monotonic() < deadline and not run_visible:
        with open_session() as db:
            run = db.get(AgentRun, created_runs[0])
            if run is not None:
                run.status = AgentRunStatus.COMPLETED
                db.add(run)
                db.commit()
                run_visible = True
                break
        time.sleep(0.05)
    assert run_visible

    notify_agent_run_terminal(created_runs[0])

    detail = client.get(f"/api/v1/import/jobs/{job_id}")
    detail.raise_for_status()
    task = detail.json()["tasks"][0]
    assert task["status"] == ImportTaskStatus.COMPLETED.value
    assert detail.json()["status"] == ImportJobStatus.COMPLETED.value
