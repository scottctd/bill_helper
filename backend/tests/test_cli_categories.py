from __future__ import annotations

import json

from backend.cli import main as cli_main
from backend.cli.rendering import render_output


PARENT = {
    "id": "11111111-1111-1111-1111-111111111111",
    "taxonomy_id": "taxonomy-1",
    "name": "food_drink",
    "normalized_name": "food_drink",
    "parent_term_id": None,
    "description": None,
    "default_lifecycle": None,
    "usage_count": 4,
}
CHILD = {
    "id": "22222222-2222-2222-2222-222222222222",
    "taxonomy_id": "taxonomy-1",
    "name": "dining_out",
    "normalized_name": "dining_out",
    "parent_term_id": PARENT["id"],
    "description": "Restaurants and takeout.",
    "default_lifecycle": "day_to_day",
    "usage_count": 3,
}


def _setup_cli_env(monkeypatch) -> None:
    monkeypatch.setenv("BH_API_BASE_URL", "http://testserver/api/v1")
    monkeypatch.setenv("BH_AUTH_TOKEN", "token")


def test_entry_categories_parser_lists_crud_commands(capsys) -> None:
    exit_code = cli_main.main(["entry-categories"])
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "entry-categories [-h] {list,get,create,update,remove}" in captured.out


def test_entry_categories_list_adds_parent_paths(monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)

    def fake_request_json(_context, method, path, **_kwargs):
        assert (method, path) == ("GET", "/taxonomies/entry_category/terms")
        return 200, [PARENT, CHILD]

    monkeypatch.setattr("backend.cli.category_commands.request_json", fake_request_json)

    assert cli_main.main(["entry-categories", "list", "--format", "json"]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert [item["path"] for item in payload] == ["food_drink", "food_drink/dining_out"]


def test_entry_categories_create_resolves_parent_name(monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)
    calls: list[tuple[str, str, dict | None]] = []

    def fake_request_json(_context, method, path, **kwargs):
        calls.append((method, path, kwargs.get("json_body")))
        if method == "GET":
            return 200, [PARENT]
        return 201, {
            **CHILD,
            "id": "33333333-3333-3333-3333-333333333333",
            "name": "groceries",
            "normalized_name": "groceries",
            "description": "Food bought for home.",
        }

    monkeypatch.setattr("backend.cli.category_commands.request_json", fake_request_json)

    assert cli_main.main(
        [
            "entry-categories",
            "create",
            "groceries",
            "--parent",
            "food_drink",
            "--description",
            "Food bought for home.",
            "--default-lifecycle",
            "day_to_day",
            "--format",
            "json",
        ]
    ) == 0
    payload = json.loads(capsys.readouterr().out)

    assert calls[1] == (
        "POST",
        "/taxonomies/entry_category/terms",
        {
            "name": "groceries",
            "description": "Food bought for home.",
            "parent_term_id": PARENT["id"],
            "default_lifecycle": "day_to_day",
        },
    )
    assert payload["path"] == "food_drink/groceries"


def test_entry_categories_update_and_remove_accept_short_ids(monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)
    calls: list[tuple[str, str, dict | None]] = []

    def fake_request_json(_context, method, path, **kwargs):
        calls.append((method, path, kwargs.get("json_body")))
        if method == "GET":
            return 200, [PARENT, CHILD]
        if method == "PATCH":
            return 200, {**CHILD, "description": None, "default_lifecycle": None}
        return 204, {"status": "OK"}

    monkeypatch.setattr("backend.cli.category_commands.request_json", fake_request_json)

    assert cli_main.main(
        [
            "entry-categories",
            "update",
            "22222222",
            "--clear-description",
            "--clear-default-lifecycle",
            "--format",
            "json",
        ]
    ) == 0
    updated = json.loads(capsys.readouterr().out)
    assert updated["path"] == "food_drink/dining_out"
    assert calls[1] == (
        "PATCH",
        f"/taxonomies/entry_category/terms/{CHILD['id']}",
        {"description": None, "default_lifecycle": None},
    )

    assert cli_main.main(["entry-categories", "remove", "food_drink/dining_out", "--format", "json"]) == 0
    removed = json.loads(capsys.readouterr().out)
    assert removed["deleted_id"] == CHILD["id"]
    assert calls[-1][:2] == (
        "DELETE",
        f"/taxonomies/entry_category/terms/{CHILD['id']}",
    )


def test_entry_category_text_rendering_shows_path_and_lifecycle() -> None:
    rendered = render_output(
        [{**CHILD, "path": "food_drink/dining_out"}],
        output_format="text",
        render_key="entry_categories_list",
    )

    assert "Entry Categories" in rendered
    assert "food_drink/dining_out" in rendered
    assert "day_to_day" in rendered


def test_entry_category_cli_crud_against_taxonomy_api(client, monkeypatch, capsys) -> None:
    _setup_cli_env(monkeypatch)

    def api_request(_context, method, path, **kwargs):
        response = client.request(
            method,
            f"/api/v1{path}",
            params=kwargs.get("params"),
            json=kwargs.get("json_body"),
        )
        response.raise_for_status()
        if response.status_code == 204:
            return 204, {"status": "OK"}
        return response.status_code, response.json()

    monkeypatch.setattr("backend.cli.category_commands.request_json", api_request)

    assert cli_main.main(
        [
            "entry-categories",
            "create",
            "cli_test_category",
            "--description",
            "Created through bh.",
            "--default-lifecycle",
            "fixed",
            "--format",
            "json",
        ]
    ) == 0
    created = json.loads(capsys.readouterr().out)

    assert cli_main.main(
        [
            "entry-categories",
            "update",
            created["id"][:8],
            "--name",
            "cli_test_category_updated",
            "--default-lifecycle",
            "one_time",
            "--format",
            "json",
        ]
    ) == 0
    updated = json.loads(capsys.readouterr().out)
    assert updated["path"] == "cli_test_category_updated"
    assert updated["default_lifecycle"] == "one_time"

    assert cli_main.main(
        ["entry-categories", "remove", "cli_test_category_updated", "--format", "json"]
    ) == 0
    removed = json.loads(capsys.readouterr().out)
    assert removed["deleted_id"] == created["id"]
