"""Rendering helpers for `bh` compact/text/json output modes.

CALLING SPEC:
    render_output(payload, output_format, render_key) -> str

Inputs:
    - decoded API payloads plus the command-specific render key
Outputs:
    - compact, text, or json strings suitable for stdout
Side effects:
    - none
"""

from __future__ import annotations

import json
from typing import Any

from backend.cli_reference import compact_schema_for
from backend.cli.dashboard_rendering import (
    render_dashboard_agent_compact,
    render_dashboard_agent_text,
    render_dashboard_finance_compact,
    render_dashboard_finance_text,
    render_dashboard_timeline_compact,
    render_dashboard_timeline_text,
)
from backend.cli.rendering_support import (
    bool_text,
    compact_row,
    compact_table,
    detail_block,
    escape_compact,
    format_minor_amount,
    render_compact_fallback,
    render_status_compact,
    render_status_text,
    render_text_fallback,
    text_table,
    unique_short_ids,
)


def render_output(payload: Any, *, output_format: str, render_key: str | None) -> str:
    if output_format == "json":
        return json.dumps(payload, indent=2, sort_keys=True)
    if output_format == "compact":
        return _render_compact(payload, render_key=render_key)
    return _render_text(payload, render_key=render_key)


def _render_compact(payload: Any, *, render_key: str | None) -> str:
    if not isinstance(payload, (dict, list)):
        return str(payload)
    renderer = _COMPACT_RENDERERS.get(render_key or "", render_compact_fallback)
    return renderer(payload)


def _render_text(payload: Any, *, render_key: str | None) -> str:
    if not isinstance(payload, (dict, list)):
        return str(payload)
    renderer = _TEXT_RENDERERS.get(render_key or "", render_text_fallback)
    return renderer(payload)


def _render_entries_list_compact(payload: dict[str, Any]) -> str:
    items = payload.get("items") or []
    short_ids = unique_short_ids(item.get("id") for item in items)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("occurred_at") or "-",
            item.get("kind") or "-",
            item.get("amount_minor") or 0,
            item.get("currency_code") or "-",
            item.get("name") or "-",
            item.get("from_entity") or "-",
            item.get("to_entity") or "-",
            ",".join(sorted(tag.get("name") or "-" for tag in item.get("tags") or [])) or "-",
            item.get("category") or "-",
            item.get("lifecycle") or "-",
        ]
        for item in items
    ]
    return compact_table(
        summary=f"returned {len(items)} of {payload.get('total', len(items))} matching entries",
        schema_key="entries_list",
        rows=rows,
    )


def _render_entries_list_text(payload: dict[str, Any]) -> str:
    items = payload.get("items") or []
    short_ids = unique_short_ids(item.get("id") for item in items)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("occurred_at") or "-",
            item.get("kind") or "-",
            format_minor_amount(item.get("amount_minor"), item.get("currency_code")),
            item.get("name") or "-",
            item.get("from_entity") or "-",
            item.get("to_entity") or "-",
            ",".join(sorted(tag.get("name") or "-" for tag in item.get("tags") or [])) or "-",
            item.get("category") or "-",
            item.get("lifecycle") or "-",
        ]
        for item in items
    ]
    return text_table(
        title=f"Entries ({len(items)} of {payload.get('total', len(items))})",
        headers=["ID", "Date", "Kind", "Amount", "Name", "From", "To", "Tags", "Category", "Lifecycle"],
        rows=rows,
        empty_text="(none)",
    )


def _format_entry_groups(groups: list[dict[str, Any]] | None) -> str:
    if not groups:
        return "-"
    return ",".join(
        escape_compact(str(group.get("name") or group.get("id") or "-"))
        for group in groups
        if isinstance(group, dict)
    ) or "-"


def _render_entry_detail_compact(payload: dict[str, Any]) -> str:
    lines = [
        compact_table(
            summary="entry detail",
            schema_key="entries_detail",
            rows=[
                [
                    payload.get("id") or "-",
                    payload.get("occurred_at") or "-",
                    payload.get("kind") or "-",
                    payload.get("amount_minor") or 0,
                    payload.get("currency_code") or "-",
                    payload.get("name") or "-",
                    payload.get("from_entity") or "-",
                    payload.get("to_entity") or "-",
                    ",".join(sorted(tag.get("name") or "-" for tag in payload.get("tags") or [])) or "-",
                    payload.get("category") or "-",
                    payload.get("lifecycle") or "-",
                    _format_entry_groups(payload.get("groups")),
                ]
            ],
        )
    ]
    if payload.get("markdown_body"):
        lines.append(f"notes: {escape_compact(payload['markdown_body'])}")
    return "\n".join(lines)


def _render_entry_detail_text(payload: dict[str, Any]) -> str:
    tags = ", ".join(sorted(tag.get("name") or "-" for tag in payload.get("tags") or [])) or "-"
    groups = payload.get("groups") or []
    group_labels = ", ".join(
        str(group.get("name") or group.get("id") or "-")
        for group in groups
        if isinstance(group, dict)
    ) or "-"
    lines = [
        detail_block(
            "Entry",
            [
                ("ID", payload.get("id")),
                ("Date", payload.get("occurred_at")),
                ("Kind", payload.get("kind")),
                ("Amount", format_minor_amount(payload.get("amount_minor"), payload.get("currency_code"))),
                ("Name", payload.get("name")),
                ("From", payload.get("from_entity") or "-"),
                ("To", payload.get("to_entity") or "-"),
                ("Tags", tags),
                ("Category", payload.get("category") or "-"),
                ("Lifecycle", payload.get("lifecycle") or "-"),
                ("Groups", group_labels),
            ],
        )
    ]
    if payload.get("markdown_body"):
        lines.extend(["", "Notes", payload["markdown_body"]])
    return "\n".join(lines)


def _render_accounts_list_compact(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("name") or "-",
            item.get("currency_code") or "-",
            bool_text(item.get("is_active")),
        ]
        for item in payload
    ]
    return compact_table(summary=f"returned {len(rows)} account(s)", schema_key="accounts_list", rows=rows)


def _render_accounts_list_text(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("name") or "-",
            item.get("currency_code") or "-",
            bool_text(item.get("is_active")),
        ]
        for item in payload
    ]
    return text_table(
        title="Accounts",
        headers=["ID", "Name", "Currency", "Active"],
        rows=rows,
        empty_text="(none)",
    )


def _render_accounts_snapshots_compact(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("snapshot_at") or "-",
            item.get("balance_minor") or 0,
            item.get("note") or "-",
        ]
        for item in payload
    ]
    return compact_table(summary=f"returned {len(rows)} snapshot(s)", schema_key="snapshots_list", rows=rows)


def _render_accounts_snapshots_text(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("snapshot_at") or "-",
            format_minor_amount(item.get("balance_minor")),
            item.get("note") or "-",
        ]
        for item in payload
    ]
    return text_table(
        title="Snapshots",
        headers=["ID", "Date", "Balance", "Note"],
        rows=rows,
        empty_text="(none)",
    )


def _render_accounts_reconciliation_compact(payload: dict[str, Any]) -> str:
    interval_rows = [
        [
            (interval.get("start_snapshot") or {}).get("snapshot_at") or "-",
            (interval.get("end_snapshot") or {}).get("snapshot_at") or "-",
            bool_text(interval.get("is_open")),
            interval.get("tracked_change_minor") or 0,
            interval.get("bank_change_minor") if interval.get("bank_change_minor") is not None else "-",
            interval.get("delta_minor") if interval.get("delta_minor") is not None else "-",
            interval.get("entry_count") or 0,
        ]
        for interval in payload.get("intervals") or []
    ]
    lines = [
        "OK",
        f"account: {escape_compact(payload.get('account_name') or '-')}",
        f"currency: {escape_compact(payload.get('currency_code') or '-')}",
        f"as_of: {escape_compact(payload.get('as_of') or '-')}",
        f"schema: {compact_schema_for('snapshots_reconciliation')}",
    ]
    if interval_rows:
        lines.extend(compact_row(row) for row in interval_rows)
    else:
        lines.append("(none)")
    return "\n".join(lines)


def _render_accounts_reconciliation_text(payload: dict[str, Any]) -> str:
    header = detail_block(
        "Reconciliation",
        [
            ("Account", payload.get("account_name")),
            ("Currency", payload.get("currency_code")),
            ("As Of", payload.get("as_of")),
        ],
    )
    rows = [
        [
            (interval.get("start_snapshot") or {}).get("snapshot_at") or "-",
            (interval.get("end_snapshot") or {}).get("snapshot_at") or "-",
            bool_text(interval.get("is_open")),
            format_minor_amount(interval.get("tracked_change_minor"), payload.get("currency_code")),
            format_minor_amount(interval.get("bank_change_minor"), payload.get("currency_code")),
            format_minor_amount(interval.get("delta_minor"), payload.get("currency_code")),
            interval.get("entry_count") or 0,
        ]
        for interval in payload.get("intervals") or []
    ]
    return header + "\n\n" + text_table(
        title="Intervals",
        headers=["Start", "End", "Open", "Tracked", "Bank", "Delta", "Entries"],
        rows=rows,
        empty_text="(none)",
    )


def _render_groups_list_compact(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("source") or "-",
            item.get("name") or "-",
            item.get("member_count") or 0,
            item.get("first_occurred_at") or "-",
            item.get("last_occurred_at") or "-",
        ]
        for item in payload
    ]
    return compact_table(summary=f"returned {len(rows)} group(s)", schema_key="groups_list", rows=rows)


def _render_groups_list_text(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [
        [
            short_ids.get(str(item.get("id")), item.get("id") or "-"),
            item.get("source") or "-",
            item.get("name") or "-",
            item.get("member_count") or 0,
            item.get("first_occurred_at") or "-",
            item.get("last_occurred_at") or "-",
        ]
        for item in payload
    ]
    return text_table(
        title="Groups",
        headers=["ID", "Source", "Name", "Members", "First Date", "Last Date"],
        rows=rows,
        empty_text="(none)",
    )


def _render_group_detail_compact(payload: dict[str, Any]) -> str:
    member_rows = [
        [
            member.get("id") or "-",
            member.get("entry_id") or "-",
            member.get("entry_name") or "-",
            member.get("override") or "-",
            member.get("occurred_at") or "-",
            member.get("kind") or "-",
            member.get("amount_minor") if member.get("amount_minor") is not None else "-",
            member.get("currency_code") or "-",
        ]
        for member in payload.get("members") or []
        if isinstance(member, dict)
    ]
    lines = [
        "OK",
        f"group_id: {escape_compact(payload.get('id') or '-')}",
        f"name: {escape_compact(payload.get('name') or '-')}",
        f"source: {escape_compact(payload.get('source') or '-')}",
        f"members: {payload.get('member_count') or len(member_rows)}",
        f"schema: {compact_schema_for('groups_detail')}",
    ]
    lines.extend(compact_row(row) for row in member_rows) if member_rows else lines.append("(none)")
    return "\n".join(lines)


def _render_group_detail_text(payload: dict[str, Any]) -> str:
    header = detail_block(
        "Group",
        [
            ("ID", payload.get("id")),
            ("Name", payload.get("name")),
            ("Source", payload.get("source")),
            ("Description", payload.get("description") or "-"),
            ("Color", payload.get("color") or "-"),
            ("Members", payload.get("member_count") or 0),
            ("First Date", payload.get("first_occurred_at") or "-"),
            ("Last Date", payload.get("last_occurred_at") or "-"),
            ("Rule Summary", payload.get("rule_summary") or "-"),
        ],
    )
    member_rows = [
        [
            member.get("id") or "-",
            member.get("entry_id") or "-",
            member.get("entry_name") or "-",
            member.get("override") or "-",
            member.get("occurred_at") or "-",
            member.get("kind") or "-",
            format_minor_amount(member.get("amount_minor"), member.get("currency_code")),
            member.get("currency_code") or "-",
        ]
        for member in payload.get("members") or []
        if isinstance(member, dict)
    ]
    return header + "\n\n" + text_table(
        title="Members",
        headers=["Membership", "Entry", "Name", "Override", "Date", "Kind", "Amount", "Currency"],
        rows=member_rows,
        empty_text="(none)",
    )


def _render_entities_list_compact(payload: list[dict[str, Any]]) -> str:
    rows = [[item.get("name") or "-", item.get("category") or "-"] for item in payload]
    return compact_table(summary=f"returned {len(rows)} entity record(s)", schema_key="entities_list", rows=rows)


def _render_entities_list_text(payload: list[dict[str, Any]]) -> str:
    rows = [[item.get("name") or "-", item.get("category") or "-"] for item in payload]
    return text_table(title="Entities", headers=["Name", "Category"], rows=rows, empty_text="(none)")


def _render_tags_list_compact(payload: list[dict[str, Any]]) -> str:
    rows = [[item.get("name") or "-", item.get("type") or "-", item.get("description") or "-"] for item in payload]
    return compact_table(summary=f"returned {len(rows)} tag(s)", schema_key="tags_list", rows=rows)


def _render_tags_list_text(payload: list[dict[str, Any]]) -> str:
    rows = [[item.get("name") or "-", item.get("type") or "-", item.get("description") or "-"] for item in payload]
    return text_table(title="Tags", headers=["Name", "Type", "Description"], rows=rows, empty_text="(none)")


def _entry_category_row(item: dict[str, Any], short_ids: dict[str, str]) -> list[Any]:
    identifier = str(item.get("id") or "")
    return [
        short_ids.get(identifier, identifier or "-"),
        item.get("path") or item.get("name") or "-",
        item.get("default_lifecycle") or "-",
        item.get("usage_count") or 0,
        item.get("description") or "-",
    ]


def _render_entry_categories_list_compact(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [_entry_category_row(item, short_ids) for item in payload]
    return compact_table(summary=f"returned {len(rows)} entry categories", schema_key="entry_categories_list", rows=rows)


def _render_entry_categories_list_text(payload: list[dict[str, Any]]) -> str:
    short_ids = unique_short_ids(item.get("id") for item in payload)
    rows = [_entry_category_row(item, short_ids) for item in payload]
    return text_table(
        title="Entry Categories",
        headers=["ID", "Path", "Default Lifecycle", "Usage", "Description"],
        rows=rows,
        empty_text="(none)",
    )


def _render_entry_category_detail_compact(payload: dict[str, Any]) -> str:
    return compact_table(
        summary="entry category detail",
        schema_key="entry_categories_detail",
        rows=[_entry_category_row(payload, {})],
    )


def _render_entry_category_detail_text(payload: dict[str, Any]) -> str:
    return detail_block(
        "Entry Category",
        [
            ("ID", payload.get("id")),
            ("Path", payload.get("path") or payload.get("name")),
            ("Default Lifecycle", payload.get("default_lifecycle") or "-"),
            ("Usage", payload.get("usage_count") or 0),
            ("Description", payload.get("description") or "-"),
        ],
    )


def _render_entry_category_mutation(payload: dict[str, Any]) -> str:
    return f"Deleted entry category {payload.get('deleted_path') or payload.get('deleted_id') or '-'}"


def _render_proposals_list_compact(payload: dict[str, Any]) -> str:
    rows = [
        [item.get("proposal_short_id") or item.get("proposal_id") or "-", item.get("status") or "-", item.get("change_type") or "-", item.get("proposal_summary") or "-"]
        for item in payload.get("proposals") or []
    ]
    return compact_table(
        summary=f"returned {payload.get('returned_count', len(rows))} of {payload.get('total_available', len(rows))} matching proposals",
        schema_key="proposals_list",
        rows=rows,
    )


def _render_proposals_list_text(payload: dict[str, Any]) -> str:
    rows = [
        [item.get("proposal_short_id") or item.get("proposal_id") or "-", item.get("status") or "-", item.get("change_type") or "-", item.get("proposal_summary") or "-"]
        for item in payload.get("proposals") or []
    ]
    return text_table(
        title=f"Proposals ({payload.get('returned_count', len(rows))} of {payload.get('total_available', len(rows))})",
        headers=["ID", "Status", "Change Type", "Summary"],
        rows=rows,
        empty_text="(none)",
    )


def _render_proposal_detail_compact(payload: dict[str, Any]) -> str:
    applied_resource = "-"
    if payload.get("applied_resource_type"):
        applied_resource = f"{payload.get('applied_resource_type')}:{payload.get('applied_resource_id') or '-'}"
    lines = [
        compact_table(
            summary="proposal detail",
            schema_key="proposals_detail",
            rows=[
                [
                    payload.get("proposal_id") or "-",
                    payload.get("status") or "-",
                    payload.get("proposal_type") or "-",
                    payload.get("change_action") or "-",
                    payload.get("change_type") or "-",
                    payload.get("proposal_summary") or "-",
                    applied_resource,
                ]
            ],
        ),
        f"payload_json: {escape_compact(json.dumps(payload.get('payload') or {}, sort_keys=True, separators=(',', ':')))}",
    ]
    review_actions = payload.get("review_actions") or []
    lines.append(f"review_schema: {compact_schema_for('proposal_reviews')}")
    if review_actions:
        lines.extend(
            compact_row(
                [action.get("action") or "-", action.get("actor") or "-", action.get("note") or "-", action.get("created_at") or "-"]
            )
            for action in review_actions
        )
    else:
        lines.append("(none)")
    return "\n".join(lines)


def _render_proposal_detail_text(payload: dict[str, Any]) -> str:
    applied_resource = "-"
    if payload.get("applied_resource_type"):
        applied_resource = f"{payload.get('applied_resource_type')}:{payload.get('applied_resource_id') or '-'}"
    review_rows = [
        [action.get("action") or "-", action.get("actor") or "-", action.get("note") or "-", action.get("created_at") or "-"]
        for action in payload.get("review_actions") or []
    ]
    return (
        detail_block(
            "Proposal",
            [
                ("ID", payload.get("proposal_id")),
                ("Short ID", payload.get("proposal_short_id") or "-"),
                ("Status", payload.get("status")),
                ("Proposal Type", payload.get("proposal_type")),
                ("Change Action", payload.get("change_action")),
                ("Change Type", payload.get("change_type")),
                ("Summary", payload.get("proposal_summary")),
                ("Applied Resource", applied_resource),
            ],
        )
        + "\n\nPayload\n"
        + json.dumps(payload.get("payload") or {}, indent=2, sort_keys=True)
        + "\n\n"
        + text_table(
            title="Review Actions",
            headers=["Action", "Actor", "Note", "Created"],
            rows=review_rows,
            empty_text="(none)",
        )
    )


def _session_rows(payload: dict[str, Any]) -> list[list[Any]]:
    sessions = payload.get("sessions") if isinstance(payload.get("sessions"), list) else [payload]
    return [
        [
            item.get("id") or "-",
            item.get("title") or "-",
            item.get("pending_change_count") or 0,
            bool_text(item.get("has_running_run")),
            item.get("updated_at") or "-",
        ]
        for item in sessions
        if isinstance(item, dict)
    ]


def _render_sessions_list_compact(payload: dict[str, Any]) -> str:
    rows = _session_rows(payload)
    return compact_table(
        summary=f"returned {len(rows)} session(s)",
        schema_key="sessions_list",
        rows=rows,
    )


def _render_session_detail_compact(payload: dict[str, Any]) -> str:
    lines = [
        compact_table(
            summary="session detail",
            schema_key="sessions_detail",
            rows=_session_rows(payload),
        )
    ]
    if payload.get("summary"):
        lines.append(f"summary_text: {escape_compact(payload['summary'])}")
    return "\n".join(lines)


def _render_sessions_list_text(payload: dict[str, Any]) -> str:
    return text_table(
        title="Sessions",
        headers=["ID", "Title", "Pending", "Running", "Updated"],
        rows=_session_rows(payload),
        empty_text="(none)",
    )


def _render_session_detail_text(payload: dict[str, Any]) -> str:
    return detail_block(
        "Session",
        [
            ("ID", payload.get("id")),
            ("Title", payload.get("title") or "-"),
            ("Pending", payload.get("pending_change_count") or 0),
            ("Running", bool_text(payload.get("has_running_run"))),
            ("Updated", payload.get("updated_at") or "-"),
            ("Summary", payload.get("summary") or "-"),
        ],
    )


def _source_rows(payload: dict[str, Any]) -> list[list[Any]]:
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else [payload]
    return [
        [
            item.get("source_id") or "-",
            item.get("display_name") or "-",
            item.get("mime_type") or "-",
            item.get("size_bytes") or 0,
            item.get("sha256") or "-",
        ]
        for item in sources
        if isinstance(item, dict)
    ]


def _render_sources_list_compact(payload: dict[str, Any]) -> str:
    rows = _source_rows(payload)
    return compact_table(
        summary=f"returned {len(rows)} source(s)",
        schema_key="sources_list",
        rows=rows,
    )


def _render_source_detail_compact(payload: dict[str, Any]) -> str:
    return compact_table(
        summary="source detail",
        schema_key="source_detail",
        rows=_source_rows(payload),
    )


def _render_sources_list_text(payload: dict[str, Any]) -> str:
    return text_table(
        title="Sources",
        headers=["Source ID", "Name", "MIME", "Bytes", "SHA256"],
        rows=_source_rows(payload),
        empty_text="(none)",
    )


def _render_source_detail_text(payload: dict[str, Any]) -> str:
    return detail_block(
        "Source",
        [
            ("Source ID", payload.get("source_id")),
            ("Name", payload.get("display_name") or "-"),
            ("MIME", payload.get("mime_type") or "-"),
            ("Bytes", payload.get("size_bytes") or 0),
            ("SHA256", payload.get("sha256") or "-"),
            ("Note", payload.get("note") or "-"),
        ],
    )


_COMPACT_RENDERERS = {
    "status": render_status_compact,
    "sessions_list": _render_sessions_list_compact,
    "sessions_detail": _render_session_detail_compact,
    "sources_list": _render_sources_list_compact,
    "source_detail": _render_source_detail_compact,
    "entries_list": _render_entries_list_compact,
    "entries_detail": _render_entry_detail_compact,
    "accounts_list": _render_accounts_list_compact,
    "snapshots_list": _render_accounts_snapshots_compact,
    "snapshots_reconciliation": _render_accounts_reconciliation_compact,
    "groups_list": _render_groups_list_compact,
    "groups_detail": _render_group_detail_compact,
    "entities_list": _render_entities_list_compact,
    "tags_list": _render_tags_list_compact,
    "entry_categories_list": _render_entry_categories_list_compact,
    "entry_categories_detail": _render_entry_category_detail_compact,
    "entry_categories_mutation": _render_entry_category_mutation,
    "proposals_list": _render_proposals_list_compact,
    "proposals_detail": _render_proposal_detail_compact,
    "dashboard_timeline": render_dashboard_timeline_compact,
    "dashboard_finance": render_dashboard_finance_compact,
    "dashboard_agent": render_dashboard_agent_compact,
}

_TEXT_RENDERERS = {
    "status": render_status_text,
    "sessions_list": _render_sessions_list_text,
    "sessions_detail": _render_session_detail_text,
    "sources_list": _render_sources_list_text,
    "source_detail": _render_source_detail_text,
    "entries_list": _render_entries_list_text,
    "entries_detail": _render_entry_detail_text,
    "accounts_list": _render_accounts_list_text,
    "snapshots_list": _render_accounts_snapshots_text,
    "snapshots_reconciliation": _render_accounts_reconciliation_text,
    "groups_list": _render_groups_list_text,
    "groups_detail": _render_group_detail_text,
    "entities_list": _render_entities_list_text,
    "tags_list": _render_tags_list_text,
    "entry_categories_list": _render_entry_categories_list_text,
    "entry_categories_detail": _render_entry_category_detail_text,
    "entry_categories_mutation": _render_entry_category_mutation,
    "proposals_list": _render_proposals_list_text,
    "proposals_detail": _render_proposal_detail_text,
    "dashboard_timeline": render_dashboard_timeline_text,
    "dashboard_finance": render_dashboard_finance_text,
    "dashboard_agent": render_dashboard_agent_text,
}
