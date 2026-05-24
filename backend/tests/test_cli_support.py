from __future__ import annotations

import argparse
import json

import pytest
from argparse import _SubParsersAction
from typing import Any

from backend.cli import main as cli_main
from backend.cli.rendering import render_output
from backend.cli.support import (
    CliError,
    build_cli_context,
    resolve_session_id,
    resolve_entry_id,
    resolve_payload_proposal_references,
    resolve_proposal_id,
    resolve_snapshot_id,
)
from backend.tests.test_entries import create_account, create_entry


def _setup_cli_env(monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")
    monkeypatch.setenv("BH_THREAD_ID", "thread-123")
    monkeypatch.setenv("BH_RUN_ID", "run-123")


def _get_subparser(parser: argparse.ArgumentParser, *names: str) -> argparse.ArgumentParser:
    action = next(
        action for action in parser._actions if isinstance(action, _SubParsersAction)
    )
    current = parser
    for name in names:
        current = action._name_parser_map[name]
        sub_actions = [
            next_action for next_action in current._actions if isinstance(next_action, _SubParsersAction)
        ]
        action = sub_actions[0] if sub_actions else None
    return current


def test_build_cli_context_reads_workspace_cli_config_when_env_missing(monkeypatch, tmp_path) -> None:
    config_path = tmp_path / "bh-env.json"
    config_path.write_text(
        json.dumps(
            {
                "api_base_url": "http://host.docker.internal:8000/api/v1",
                "auth_token": "workspace-token",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", tmp_path / "missing-local.json")
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", config_path)
    monkeypatch.delenv("BH_API_BASE_URL", raising=False)
    monkeypatch.delenv("BH_AUTH_TOKEN", raising=False)

    context = build_cli_context(output_format="json")

    assert context.api_base_url == "http://host.docker.internal:8000/api/v1"
    assert context.auth_token == "workspace-token"


def test_build_cli_context_reads_session_id_from_cli_config(monkeypatch, tmp_path) -> None:
    config_path = tmp_path / "bh-env.json"
    config_path.write_text(
        json.dumps(
            {
                "api_base_url": "http://example/api/v1",
                "auth_token": "workspace-token",
                "session_id": "session-123",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", tmp_path / "missing-local.json")
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", config_path)
    monkeypatch.delenv("BH_API_BASE_URL", raising=False)
    monkeypatch.delenv("BH_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("BH_SESSION_ID", raising=False)
    monkeypatch.delenv("BH_THREAD_ID", raising=False)

    context = build_cli_context(output_format="json")

    assert context.thread_id == "session-123"


def test_build_cli_context_merges_local_session_with_workspace_auth(monkeypatch, tmp_path) -> None:
    workspace_config = tmp_path / "workspace-bh-env.json"
    local_config = tmp_path / "local-bh-env.json"
    workspace_config.write_text(
        json.dumps(
            {
                "api_base_url": "http://workspace/api/v1",
                "auth_token": "workspace-token",
                "session_id": "workspace-session",
            }
        ),
        encoding="utf-8",
    )
    local_config.write_text(json.dumps({"session_id": "local-session"}), encoding="utf-8")
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", local_config)
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", workspace_config)
    monkeypatch.delenv("BH_API_BASE_URL", raising=False)
    monkeypatch.delenv("BH_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("BH_SESSION_ID", raising=False)
    monkeypatch.delenv("BH_THREAD_ID", raising=False)

    context = build_cli_context(output_format="json")

    assert context.api_base_url == "http://workspace/api/v1"
    assert context.auth_token == "workspace-token"
    assert context.thread_id == "local-session"


def test_build_cli_context_prefers_bh_env_over_workspace_cli_config(monkeypatch, tmp_path) -> None:
    config_path = tmp_path / "bh-env.json"
    config_path.write_text(
        json.dumps(
            {
                "api_base_url": "http://from-config/api/v1",
                "auth_token": "config-token",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", tmp_path / "missing-local.json")
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", config_path)
    monkeypatch.setenv("BH_API_BASE_URL", "http://from-env/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "env-token")

    context = build_cli_context(output_format="json")

    assert context.api_base_url == "http://from-env/api/v1"
    assert context.auth_token == "env-token"


def test_build_cli_context_raises_helpful_error_when_cli_context_missing(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", tmp_path / "missing-local.json")
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", tmp_path / "missing.json")
    monkeypatch.delenv("BH_API_BASE_URL", raising=False)
    monkeypatch.delenv("BH_AUTH_TOKEN", raising=False)

    with pytest.raises(CliError) as exc:
        build_cli_context(output_format="json")

    assert "configure the bh CLI config file" in str(exc.value)


def test_build_cli_context_defaults_to_compact_when_stdout_is_not_tty(monkeypatch, tmp_path) -> None:
    config_path = tmp_path / "bh-env.json"
    config_path.write_text(
        json.dumps({"api_base_url": "http://example/api/v1", "auth_token": "workspace-token"}),
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", tmp_path / "missing-local.json")
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", config_path)
    monkeypatch.setattr("backend.cli.support.sys.stdout.isatty", lambda: False)

    context = build_cli_context()

    assert context.output_format == "compact"


def test_build_cli_context_defaults_to_text_when_stdout_is_tty(monkeypatch, tmp_path) -> None:
    config_path = tmp_path / "bh-env.json"
    config_path.write_text(
        json.dumps({"api_base_url": "http://example/api/v1", "auth_token": "workspace-token"}),
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", tmp_path / "missing-local.json")
    monkeypatch.setattr("backend.cli.support._WORKSPACE_CLI_CONFIG_PATH", config_path)
    monkeypatch.setattr("backend.cli.support.sys.stdout.isatty", lambda: True)

    context = build_cli_context()

    assert context.output_format == "text"


def test_render_output_uses_compact_schema_for_entries_list() -> None:
    rendered = render_output(
        {
            "items": [
                {
                    "id": "12345678-abcd-ef01-2345-6789abcdef01",
                    "occurred_at": "2026-03-12",
                    "kind": "EXPENSE",
                    "amount_minor": 1234,
                    "currency_code": "CAD",
                    "name": "Farm Boy",
                    "from_entity": None,
                    "to_entity": "Farm Boy",
                    "tags": [{"name": "grocery"}],
                }
            ],
            "total": 1,
            "limit": 20,
            "offset": 0,
        },
        output_format="compact",
        render_key="entries_list",
    )

    assert "schema: id|date|kind|amount_minor|currency|name|from|to|tags" in rendered
    assert "12345678|2026-03-12|EXPENSE|1234|CAD|Farm Boy|-|Farm Boy|grocery" in rendered
    assert "color" not in rendered


def test_render_output_formats_entry_amounts_as_major_units_in_text() -> None:
    rendered = render_output(
        {
            "items": [
                {
                    "id": "12345678-abcd-ef01-2345-6789abcdef01",
                    "occurred_at": "2026-03-22",
                    "kind": "EXPENSE",
                    "amount_minor": 4903,
                    "currency_code": "CAD",
                    "name": "Fantuan Delivery",
                    "from_entity": "Scotiabank Credit",
                    "to_entity": "Fantuan",
                    "tags": [{"name": "dining_out"}],
                }
            ],
            "total": 1,
            "limit": 20,
            "offset": 0,
        },
        output_format="text",
        render_key="entries_list",
    )

    assert "49.03 CAD" in rendered
    assert "4903 CAD" not in rendered


def test_render_output_formats_entry_detail_amount_as_major_units_in_text() -> None:
    rendered = render_output(
        {
            "id": "12345678-abcd-ef01-2345-6789abcdef01",
            "occurred_at": "2026-03-22",
            "kind": "EXPENSE",
            "amount_minor": -123,
            "currency_code": "CAD",
            "name": "Refund",
            "from_entity": "Merchant",
            "to_entity": "Checking",
            "tags": [],
        },
        output_format="text",
        render_key="entries_detail",
    )

    assert "Amount: -1.23 CAD" in rendered


def test_render_output_formats_reconciliation_amounts_as_major_units_in_text() -> None:
    payload = {
        "account_name": "Checking",
        "currency_code": "CAD",
        "as_of": "2026-03-31",
        "intervals": [
            {
                "start_snapshot": {"snapshot_at": "2026-03-01"},
                "end_snapshot": {"snapshot_at": "2026-03-31"},
                "is_open": False,
                "tracked_change_minor": 12345,
                "bank_change_minor": -567,
                "delta_minor": None,
                "entry_count": 4,
            }
        ],
    }
    rendered = render_output(
        payload,
        output_format="text",
        render_key="snapshots_reconciliation",
    )

    assert "123.45 CAD" in rendered
    assert "-5.67 CAD" in rendered
    assert "12345" not in rendered


def test_render_output_preserves_minor_amounts_in_reconciliation_compact() -> None:
    rendered = render_output(
        {
            "account_name": "Checking",
            "currency_code": "CAD",
            "as_of": "2026-03-31",
            "intervals": [
                {
                    "start_snapshot": {"snapshot_at": "2026-03-01"},
                    "end_snapshot": {"snapshot_at": "2026-03-31"},
                    "is_open": False,
                    "tracked_change_minor": 12345,
                    "bank_change_minor": -567,
                    "delta_minor": None,
                    "entry_count": 4,
                }
            ],
        },
        output_format="compact",
        render_key="snapshots_reconciliation",
    )

    assert "schema: start|end|open|tracked_change_minor|bank_change_minor|delta_minor|entry_count" in rendered
    assert "2026-03-01|2026-03-31|false|12345|-567|-|4" in rendered
    assert "123.45" not in rendered


def test_render_output_formats_snapshot_balances_as_major_units_in_text() -> None:
    payload = [
        {
            "id": "abcdefab-cdef-0123-4567-89abcdef0123",
            "snapshot_at": "2026-03-31",
            "balance_minor": 12345,
            "note": "statement",
        }
    ]

    text_rendered = render_output(payload, output_format="text", render_key="snapshots_list")
    compact_rendered = render_output(payload, output_format="compact", render_key="snapshots_list")

    assert "123.45" in text_rendered
    assert "12345" not in text_rendered
    assert "abcdefab|2026-03-31|12345|statement" in compact_rendered
    assert "123.45" not in compact_rendered


def test_render_output_formats_group_node_amounts_as_major_units_in_text() -> None:
    payload = {
        "id": "group-123",
        "name": "Trip",
        "group_type": "manual",
        "nodes": [
            {
                "subject_id": "entry-123",
                "node_type": "entry",
                "name": "Hotel",
                "member_role": "member",
                "occurred_at": "2026-03-31",
                "kind": "EXPENSE",
                "amount_minor": 12345,
                "currency_code": "CAD",
            }
        ],
        "edges": [],
    }

    text_rendered = render_output(payload, output_format="text", render_key="groups_detail")
    compact_rendered = render_output(payload, output_format="compact", render_key="groups_detail")

    assert "123.45 CAD" in text_rendered
    assert "12345" not in text_rendered
    assert "entry-123|entry|Hotel|member|2026-03-31|EXPENSE|12345|-|-" in compact_rendered
    assert "123.45" not in compact_rendered


def test_render_output_falls_back_to_full_id_when_short_ids_collide() -> None:
    rendered = render_output(
        {
            "items": [
                {
                    "id": "12345678-abcd-ef01-2345-6789abcdef01",
                    "occurred_at": "2026-03-12",
                    "kind": "EXPENSE",
                    "amount_minor": 1234,
                    "currency_code": "CAD",
                    "name": "Farm Boy",
                    "from_entity": None,
                    "to_entity": "Farm Boy",
                    "tags": [],
                },
                {
                    "id": "12345678-ffff-ef01-2345-6789abcdef02",
                    "occurred_at": "2026-03-13",
                    "kind": "EXPENSE",
                    "amount_minor": 5678,
                    "currency_code": "CAD",
                    "name": "Metro",
                    "from_entity": None,
                    "to_entity": "Metro",
                    "tags": [],
                },
            ],
            "total": 2,
            "limit": 20,
            "offset": 0,
        },
        output_format="compact",
        render_key="entries_list",
    )

    assert "12345678-abcd-ef01-2345-6789abcdef01" in rendered
    assert "12345678-ffff-ef01-2345-6789abcdef02" in rendered


def test_render_output_uses_renderer_for_accounts_list_payloads() -> None:
    rendered = render_output(
        [
            {
                "id": "12345678-abcd-ef01-2345-6789abcdef01",
                "name": "Checking",
                "currency_code": "USD",
                "is_active": True,
            }
        ],
        output_format="text",
        render_key="accounts_list",
    )

    assert "Accounts" in rendered
    assert "12345678" in rendered
    assert "Checking" in rendered
    assert "'id':" not in rendered


def test_render_output_includes_tag_description_in_compact_and_text() -> None:
    payload = [
        {
            "name": "grocery",
            "type": "expense",
            "description": "Food bought from stores.",
        }
    ]

    compact_rendered = render_output(
        payload,
        output_format="compact",
        render_key="tags_list",
    )
    text_rendered = render_output(
        payload,
        output_format="text",
        render_key="tags_list",
    )

    assert "schema: name|type|description" in compact_rendered
    assert "grocery|expense|Food bought from stores." in compact_rendered
    assert "Description" in text_rendered
    assert "Food bought from stores." in text_rendered


def test_login_command_saves_cli_config_without_printing_token(monkeypatch, tmp_path, capsys) -> None:
    config_path = tmp_path / "bh-env.json"
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", config_path)
    monkeypatch.setattr("backend.cli.main.request_login", lambda **_kwargs: {
        "token": "secret-token",
        "session_id": "auth-session-1",
        "user": {"name": "admin"},
    })

    exit_code = cli_main.main(
        [
            "login",
            "--api-base-url",
            "http://localhost:8000/api/v1",
            "--username",
            "admin",
            "--password",
            "password",
            "--format",
            "json",
        ]
    )
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "secret-token" not in captured.out
    payload = json.loads(captured.out)
    assert payload["user"] == "admin"
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved == {
        "api_base_url": "http://localhost:8000/api/v1",
        "auth_token": "secret-token",
    }


def test_sessions_create_use_saves_current_session(monkeypatch, tmp_path, capsys) -> None:
    _setup_cli_env(monkeypatch)
    config_path = tmp_path / "bh-env.json"
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", config_path)

    def fake_request_json(context, method, path, **kwargs):
        assert method == "POST"
        assert path == "/agent/sessions"
        assert kwargs["json_body"]["title"] == "May receipts"
        return 201, {
            "id": "session-123",
            "title": "May receipts",
            "pending_change_count": 0,
            "has_running_run": False,
        }

    monkeypatch.setattr("backend.cli.session_commands.request_json", fake_request_json)
    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)
    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    exit_code = cli_main.main(
        [
            "sessions",
            "create",
            "--title",
            "May receipts",
            "--use",
            "--format",
            "json",
        ]
    )
    capsys.readouterr()

    assert exit_code == 0
    assert json.loads(config_path.read_text(encoding="utf-8"))["session_id"] == "session-123"


def test_sessions_use_accepts_short_session_id(monkeypatch, tmp_path, capsys) -> None:
    _setup_cli_env(monkeypatch)
    config_path = tmp_path / "bh-env.json"
    monkeypatch.setattr("backend.cli.support._LOCAL_CLI_CONFIG_PATH", config_path)
    calls: list[tuple[str, str]] = []

    def fake_request_json(context, method, path, **kwargs):
        calls.append((method, path))
        if method == "GET" and path == "/agent/sessions":
            return 200, {
                "sessions": [
                    {
                        "id": "session-1234-5678",
                        "title": "May receipts",
                        "pending_change_count": 0,
                        "has_running_run": False,
                    }
                ]
            }
        if method == "GET" and path == "/agent/sessions/session-1234-5678":
            return 200, {
                "id": "session-1234-5678",
                "title": "May receipts",
                "pending_change_count": 0,
                "has_running_run": False,
            }
        raise AssertionError(f"Unexpected path: {method} {path}")

    monkeypatch.setattr("backend.cli.session_commands.request_json", fake_request_json)
    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    exit_code = cli_main.main(["sessions", "use", "session", "--format", "json"])
    capsys.readouterr()

    assert exit_code == 0
    assert calls == [
        ("GET", "/agent/sessions"),
        ("GET", "/agent/sessions/session-1234-5678"),
    ]
    assert json.loads(config_path.read_text(encoding="utf-8"))["session_id"] == "session-1234-5678"


def test_instruction_accepts_subcommand_format_option(capsys) -> None:
    exit_code = cli_main.main(["instruction", "--format", "json"])
    captured = capsys.readouterr()

    assert exit_code == 0
    payload = json.loads(captured.out)
    assert "bh login" in payload["instruction"]
    assert "bh sessions sources add-file" in payload["instruction"]
    assert "## Domain Rules" in payload["instruction"]
    assert "## Proposal Workflow" in payload["instruction"]
    assert "rename_thread" not in payload["instruction"]


def test_entries_parser_without_subcommand_prints_entries_help(capsys) -> None:
    exit_code = cli_main.main(["entries"])
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "usage: " in captured.out
    assert "entries [-h] {list,get,create,import,update,remove}" in captured.out
    assert "threads" not in captured.out


def test_top_level_help_omits_removed_commands() -> None:
    parser = cli_main._build_parser()
    help_text = parser.format_help()

    assert "threads" not in help_text
    assert "reviews" not in help_text
    assert "\n  workspace" not in help_text
    assert "snapshots" in help_text


def test_proposals_parser_includes_update_and_remove(capsys) -> None:
    exit_code = cli_main.main(["proposals"])
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "proposals [-h] {list,get,update,remove}" in captured.out


def test_resolve_entry_id_accepts_short_prefix(client, monkeypatch) -> None:
    account_id = create_account(client)
    entry = create_entry(client, account_id, "Coffee")
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")

    def fake_request_json(context, method, path, **kwargs):
        if method == "GET" and path == "/entries":
            response = client.get(
                "/api/v1/entries",
                params=kwargs.get("params"),
            )
        else:
            raise AssertionError(f"Unexpected path: {method} {path}")
        response.raise_for_status()
        return response.status_code, response.json()

    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    resolved = resolve_entry_id(build_cli_context(output_format="json"), entry_id=entry["id"][:8])

    assert resolved == entry["id"]


def test_resolve_proposal_id_accepts_short_prefix(client, monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")
    monkeypatch.setenv("BH_RUN_ID", "run-123")

    def fake_request_json(context, method, path, **kwargs):
        assert method == "GET"
        assert path == "/agent/threads/thread-123/proposals"
        assert kwargs.get("include_run_id") is True
        return 200, {
            "returned_count": 1,
            "total_available": 1,
            "proposals": [
                {
                    "proposal_id": "293272a6-44da-42cc-b2e4-43644a729979",
                    "proposal_short_id": "293272a6",
                }
            ],
        }

    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    resolved = resolve_proposal_id(
        build_cli_context(output_format="json"),
        thread_id="thread-123",
        proposal_id="293272a6",
    )

    assert resolved == "293272a6-44da-42cc-b2e4-43644a729979"


def test_resolve_session_id_accepts_short_prefix(monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")

    def fake_request_json(context, method, path, **kwargs):
        assert method == "GET"
        assert path == "/agent/sessions"
        return 200, {
            "sessions": [
                {
                    "id": "4dcbca9e-44da-42cc-b2e4-43644a729979",
                    "title": "May receipts",
                }
            ]
        }

    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    resolved = resolve_session_id(
        build_cli_context(output_format="json"),
        session_id="4dcbca9e",
    )

    assert resolved == "4dcbca9e-44da-42cc-b2e4-43644a729979"


def test_resolve_snapshot_id_accepts_short_prefix(client, monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")

    def fake_request_json(context, method, path, **kwargs):
        assert method == "GET"
        assert path == "/accounts/account-123/snapshots"
        return 200, [
            {
                "id": "4dcbca9e-44da-42cc-b2e4-43644a729979",
                "snapshot_at": "2026-03-15",
                "balance_minor": 12345,
                "note": "statement",
            }
        ]

    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    resolved = resolve_snapshot_id(
        build_cli_context(output_format="json"),
        account_id="account-123",
        snapshot_id="4dcbca9e",
    )

    assert resolved == "4dcbca9e-44da-42cc-b2e4-43644a729979"


def test_resolve_payload_proposal_references_canonicalizes_nested_refs(monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")
    monkeypatch.setenv("BH_RUN_ID", "run-123")

    request_count = 0

    def fake_request_json(context, method, path, **kwargs):
        nonlocal request_count
        request_count += 1
        assert method == "GET"
        assert path == "/agent/threads/thread-123/proposals"
        assert kwargs.get("include_run_id") is True
        return 200, {
            "returned_count": 2,
            "total_available": 2,
            "proposals": [
                {
                    "proposal_id": "293272a6-44da-42cc-b2e4-43644a729979",
                    "proposal_short_id": "293272a6",
                },
                {
                    "proposal_id": "70dcb3a0-c965-44b3-a041-6d5a8a3d2c8c",
                    "proposal_short_id": "70dcb3a0",
                },
            ],
        }

    monkeypatch.setattr("backend.cli.support.request_json", fake_request_json)

    resolved = resolve_payload_proposal_references(
        build_cli_context(output_format="json"),
        thread_id="thread-123",
        payload={
            "group_ref": {"create_group_proposal_id": "293272a6"},
            "target": {
                "target_type": "entry",
                "entry_ref": {"create_entry_proposal_id": "70dcb3a0"},
            },
        },
    )

    assert resolved == {
        "group_ref": {"create_group_proposal_id": "293272a6-44da-42cc-b2e4-43644a729979"},
        "target": {
            "target_type": "entry",
            "entry_ref": {"create_entry_proposal_id": "70dcb3a0-c965-44b3-a041-6d5a8a3d2c8c"},
        },
    }
    assert request_count == 1


def test_group_and_account_lists_render_short_ids() -> None:
    accounts_rendered = render_output(
        [
            {
                "id": "abcdef12-1234-5678-90ab-cdef12345678",
                "name": "Main Checking",
                "currency_code": "USD",
                "is_active": True,
            }
        ],
        output_format="compact",
        render_key="accounts_list",
    )
    groups_rendered = render_output(
        [
            {
                "id": "fedcba98-1234-5678-90ab-cdef12345678",
                "group_type": "BUNDLE",
                "name": "Bills",
                "descendant_entry_count": 3,
                "first_occurred_at": "2026-01-01",
                "last_occurred_at": "2026-03-01",
            }
        ],
        output_format="compact",
        render_key="groups_list",
    )

    assert "abcdef12|Main Checking|USD|true" in accounts_rendered
    assert "fedcba98|BUNDLE|Bills|3|2026-01-01|2026-03-01" in groups_rendered


def test_entries_create_help_mentions_required_and_optional_fields() -> None:
    parser = cli_main._build_parser()
    create_parser = _get_subparser(parser, "entries", "create")
    help_text = create_parser.format_help()

    assert "Required fields:" in help_text
    assert "--amount-minor" in help_text
    assert "Optional fields:" in help_text


def test_accounts_create_help_mentions_required_and_optional_fields() -> None:
    parser = cli_main._build_parser()
    create_parser = _get_subparser(parser, "accounts", "create")
    help_text = create_parser.format_help()

    assert "Required fields:" in help_text
    assert "--currency-code" in help_text
    assert "--inactive" in help_text


def test_snapshots_create_help_mentions_required_and_optional_fields() -> None:
    parser = cli_main._build_parser()
    create_parser = _get_subparser(parser, "snapshots", "create")
    help_text = create_parser.format_help()

    assert "Required fields:" in help_text
    assert "--snapshot-at" in help_text
    assert "--note" in help_text


def test_entries_create_parses_tags_and_amount(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)

    captured_payload: dict[str, Any] = {}

    def fake_create_thread_proposal(context, *, change_type=None, payload_json=None, **kwargs):
        captured_payload.update(payload_json or {})
        return {"status": "OK", "proposal_id": "proposal-1"}

    monkeypatch.setattr("backend.cli.main._create_thread_proposal", fake_create_thread_proposal)

    exit_code = cli_main.main(
        [
            "entries",
            "create",
            "--kind",
            "EXPENSE",
            "--date",
            "2026-03-16",
            "--name",
            "Farm Boy",
            "--amount-minor",
            "1234",
            "--from-entity",
            "Checking",
            "--to-entity",
            "Farm Boy",
            "--currency-code",
            "cad",
            "--tag",
            "groceries",
            "--tag",
            "one_time",
        ]
    )

    assert exit_code == 0
    assert captured_payload["tags"] == ["groceries", "one_time"]
    assert captured_payload["currency_code"] == "CAD"


def test_accounts_create_respects_active_inactive_flags(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)

    captured_payload: dict[str, Any] = {}

    def fake_create_thread_proposal(context, *, change_type=None, payload_json=None, **kwargs):
        captured_payload.update(payload_json or {})
        return {"status": "OK", "proposal_id": "proposal-2"}

    monkeypatch.setattr("backend.cli.main._create_thread_proposal", fake_create_thread_proposal)

    exit_code = cli_main.main(
        [
            "accounts",
            "create",
            "--name",
            "Checking",
            "--currency-code",
            "USD",
            "--inactive",
        ]
    )

    assert exit_code == 0
    assert captured_payload["is_active"] is False

    captured_payload.clear()

    exit_code = cli_main.main(
        [
            "accounts",
            "create",
            "--name",
            "Savings",
            "--currency-code",
            "USD",
            "--is-active",
        ]
    )

    assert exit_code == 0
    assert captured_payload["is_active"] is True


def test_snapshots_create_normalizes_account_id_and_balance(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)

    captured_payload: dict[str, Any] = {}

    def fake_create_thread_proposal(context, *, change_type=None, payload_json=None, **kwargs):
        captured_payload.update(payload_json or {})
        return {"status": "OK", "proposal_id": "proposal-3"}

    monkeypatch.setattr("backend.cli.main._create_thread_proposal", fake_create_thread_proposal)
    monkeypatch.setattr(
        "backend.cli.create_commands.resolve_account_id",
        lambda context, account_id: "account-12345678",
    )

    exit_code = cli_main.main(
        [
            "snapshots",
            "create",
            "--account-id",
            "12345678",
            "--snapshot-at",
            "2026-03-16",
            "--balance",
            "1234.56",
            "--note",
            "statement balance",
        ]
    )

    assert exit_code == 0
    assert captured_payload["account_id"] == "account-12345678"
    assert captured_payload["balance"] == "1234.56"
    assert captured_payload["note"] == "statement balance"


def test_entries_create_validation_error_is_friendly(monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)

    exit_code = cli_main.main(
        [
            "entries",
            "create",
            "--kind",
            "EXPENSE",
            "--date",
            "invalid-date",
            "--name",
            "Farm Boy",
            "--amount-minor",
            "1234",
            "--from-entity",
            "Checking",
            "--to-entity",
            "Farm Boy",
        ]
    )

    captured = capsys.readouterr()

    assert exit_code == 1
    assert "Invalid entry create arguments." in captured.err
    assert "https://errors.pydantic" not in captured.err


def test_entries_import_posts_batch_payload(monkeypatch) -> None:
    _setup_cli_env(monkeypatch)
    captured: dict[str, Any] = {}

    def fake_request_json(context, method, path, **kwargs):
        captured["method"] = method
        captured["path"] = path
        captured["json_body"] = kwargs.get("json_body")
        return 201, {
            "returned_count": 1,
            "total_available": 1,
            "proposals": [],
        }

    monkeypatch.setattr("backend.cli.main.request_json", fake_request_json)

    exit_code = cli_main.main(
        [
            "entries",
            "import",
            "--payload-json",
            json.dumps(
                {
                    "entries": [
                        {
                            "kind": "EXPENSE",
                            "date": "2026-03-15",
                            "name": "Farm Boy",
                            "amount_minor": 1234,
                            "from_entity": "Checking",
                            "to_entity": "Farm Boy",
                        }
                    ]
                }
            ),
        ]
    )

    assert exit_code == 0
    assert captured["method"] == "POST"
    assert captured["path"] == "/agent/threads/thread-123/proposals/batch-entries"
    assert captured["json_body"]["entries"][0]["name"] == "Farm Boy"


def test_entries_import_requires_exactly_one_json_source(monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)

    with pytest.raises(SystemExit) as exc_info:
        cli_main.main(["entries", "import"])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "one of the arguments --payload-json --payload-file is required" in captured.err


def test_entries_import_validation_error_is_friendly(monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)

    exit_code = cli_main.main(
        [
            "entries",
            "import",
            "--payload-json",
            json.dumps({"entries": []}),
        ]
    )

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "Invalid entry import payload:" in captured.err
    assert "https://errors.pydantic" not in captured.err
