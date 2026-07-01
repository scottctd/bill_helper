from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import event

from backend.tests.conftest import _test_engine
from backend.tests.test_entries import _expense_tag_rule, create_account, create_entry, create_group


@contextmanager
def count_sql_statements():
    engine = _test_engine()
    state = {"count": 0}

    def _before_cursor_execute(
        conn,
        cursor,
        statement,
        parameters,
        context,
        executemany,
    ) -> None:
        state["count"] += 1

    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    try:
        yield state
    finally:
        event.remove(engine, "before_cursor_execute", _before_cursor_execute)


def _seed_entries_for_group_filter(client, *, entry_count: int, label: str) -> str:
    tag = f"coffee_snacks_{label}"
    account_id = create_account(client, name=f"Checking {label}")
    group = create_group(
        client,
        f"snacks {label}",
        source="rule",
        rule=_expense_tag_rule(tags=[tag]),
    )
    for index in range(entry_count):
        create_entry(
            client,
            account_id,
            f"Snack {label} {index}",
            occurred_at=f"2026-01-{index + 1:02d}",
            kind="EXPENSE",
        )
    matching = client.post(
        "/api/v1/entries",
        json={
            "from_entity_id": account_id,
            "to_entity": "Counterparty",
            "kind": "EXPENSE",
            "occurred_at": "2026-02-01",
            "name": f"Coffee {label}",
            "amount_minor": 500,
            "currency_code": "USD",
            "tags": [tag],
        },
    )
    matching.raise_for_status()
    return group["id"]


def test_entries_list_group_filter_query_count_is_constant(client) -> None:
    small_group_id = _seed_entries_for_group_filter(client, entry_count=10, label="small")
    with count_sql_statements() as small_state:
        small_response = client.get(
            "/api/v1/entries",
            params={"group_id": small_group_id, "limit": 50},
        )
    small_response.raise_for_status()
    assert small_response.json()["total"] == 1
    small_count = small_state["count"]

    large_group_id = _seed_entries_for_group_filter(client, entry_count=30, label="large")
    with count_sql_statements() as large_state:
        large_response = client.get(
            "/api/v1/entries",
            params={"group_id": large_group_id, "limit": 50},
        )
    large_response.raise_for_status()
    assert large_response.json()["total"] == 1
    large_count = large_state["count"]

    assert small_count == large_count
    assert small_count <= 12
