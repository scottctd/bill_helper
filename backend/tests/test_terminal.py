from __future__ import annotations

from types import SimpleNamespace

from backend.database import get_session_maker
from backend.models_agent import AgentRun, AgentThread
from backend.services.agent.tool_args.terminal import RunBhArgs
from backend.services.agent.tool_types import ToolContext
from backend.services.agent.terminal import run_bh
from backend.tests.agent_test_utils import create_thread, patch_model, send_message


def test_run_bh_injects_cli_context_and_scrubs_token(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for bh runner tool context.")
    db = get_session_maker()()
    captured: dict[str, object] = {}
    try:
        run_row = db.get(AgentRun, run["id"])
        assert run_row is not None
        thread_row = db.get(AgentThread, run_row.thread_id)
        assert thread_row is not None

        def fake_subprocess_run(command, **kwargs):
            captured["command"] = command
            captured.update(kwargs)
            token = kwargs["env"]["BH_AUTH_TOKEN"]
            return SimpleNamespace(
                returncode=0,
                stdout=f"token={token}",
                stderr="",
            )

        monkeypatch.setattr(
            "backend.services.agent.terminal.subprocess.run",
            fake_subprocess_run,
        )

        result = run_bh(
            ToolContext(
                db=db,
                run_id=run["id"],
                principal_name="admin",
                principal_user_id=thread_row.owner_user_id,
                principal_is_admin=False,
            ),
            RunBhArgs(command="bh status"),
        )
    finally:
        db.close()

    assert result.status.value == "ok"
    assert captured["command"][1:3] == ["-m", "backend.cli.main"]
    assert captured["command"][-1] == "status"
    assert captured["env"]["BH_THREAD_ID"] == thread["id"]
    assert captured["env"]["BH_SESSION_ID"] == thread["id"]
    assert captured["env"]["BH_RUN_ID"] == run["id"]
    assert captured["env"]["BH_API_BASE_URL"]
    assert captured["env"]["BH_AUTH_TOKEN"]
    assert result.output_json["stdout"] == "token=***"
    assert result.output_json["summary"] == "bh command completed"


def test_run_bh_allows_current_session_update(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for session update context.")
    db = get_session_maker()()
    captured: dict[str, object] = {}
    try:
        run_row = db.get(AgentRun, run["id"])
        assert run_row is not None
        thread_row = db.get(AgentThread, run_row.thread_id)
        assert thread_row is not None

        def fake_subprocess_run(command, **kwargs):
            captured["command"] = command
            captured.update(kwargs)
            return SimpleNamespace(returncode=0, stdout="updated", stderr="")

        monkeypatch.setattr(
            "backend.services.agent.terminal.subprocess.run",
            fake_subprocess_run,
        )

        result = run_bh(
            ToolContext(
                db=db,
                run_id=run["id"],
                principal_name="admin",
                principal_user_id=thread_row.owner_user_id,
                principal_is_admin=False,
            ),
            RunBhArgs(command='bh sessions update --summary "Reviewed May receipts"'),
        )
    finally:
        db.close()

    assert result.status.value == "ok"
    assert captured["command"][-4:] == ["sessions", "update", "--summary", "Reviewed May receipts"]


def test_run_bh_rejects_hosted_session_management_commands(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    monkeypatch.setattr(
        "backend.services.agent.terminal.subprocess.run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("subprocess should not run")),
    )

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for session policy context.")
    db = get_session_maker()()
    try:
        run_row = db.get(AgentRun, run["id"])
        assert run_row is not None
        thread_row = db.get(AgentThread, run_row.thread_id)
        assert thread_row is not None
        context = ToolContext(
            db=db,
            run_id=run["id"],
            principal_name="admin",
            principal_user_id=thread_row.owner_user_id,
            principal_is_admin=False,
        )

        rejected_commands = [
            "bh login --username admin --password nope",
            "bh instruction",
            "bh sessions list",
            'bh sessions create --title "May receipts"',
            "bh sessions use abc123",
            "bh sessions get",
            "bh sessions sources list",
            'bh sessions update abc123 --summary "wrong target"',
            "bh sessions update --summary-file summary.md",
        ]
        for command in rejected_commands:
            result = run_bh(context, RunBhArgs(command=command))
            assert result.status.value == "error"
            assert result.output_json["summary"] == "bh command failed"
    finally:
        db.close()


def test_run_bh_rejects_non_bh_commands(client, monkeypatch) -> None:
    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})

    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for bh runner context.")
    db = get_session_maker()()
    try:
        run_row = db.get(AgentRun, run["id"])
        assert run_row is not None
        thread_row = db.get(AgentThread, run_row.thread_id)
        assert thread_row is not None

        result = run_bh(
            ToolContext(
                db=db,
                run_id=run["id"],
                principal_name="admin",
                principal_user_id=thread_row.owner_user_id,
                principal_is_admin=False,
            ),
            RunBhArgs(command="echo done"),
        )
    finally:
        db.close()

    assert result.status.value == "error"
    assert result.output_json["summary"] == "bh command failed"
    assert "only supports `bh ...`" in result.output_json["details"]


def test_legacy_terminal_tool_alias_runs_bh(client, monkeypatch) -> None:
    from backend.services.agent.tool_runtime_support.execution import execute_tool

    patch_model(monkeypatch, lambda _messages: {"role": "assistant", "content": "ok"})
    thread = create_thread(client)
    run = send_message(client, thread["id"], "Create a run for legacy terminal context.")
    db = get_session_maker()()
    try:
        run_row = db.get(AgentRun, run["id"])
        assert run_row is not None
        thread_row = db.get(AgentThread, run_row.thread_id)
        assert thread_row is not None

        monkeypatch.setattr(
            "backend.services.agent.terminal.subprocess.run",
            lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout="OK", stderr=""),
        )

        result = execute_tool(
            "terminal",
            {"command": "bh status"},
            ToolContext(
                db=db,
                run_id=run["id"],
                principal_name="admin",
                principal_user_id=thread_row.owner_user_id,
                principal_is_admin=False,
            ),
        )
    finally:
        db.close()

    assert result.status.value == "ok"
    assert result.output_json["summary"] == "bh command completed"
