# CALLING SPEC:
# - Purpose: implement focused service logic for `groups`.
# - Inputs: callers that import `backend/services/agent/read_tools/groups.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `groups`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from backend.models_finance import Group
from backend.services.agent.group_references import (
    find_groups_by_id,
    group_detail_public_record,
    group_id_ambiguity_details,
    group_owner_condition,
    group_summary_to_public_record,
)
from backend.services.agent.read_tools.common import (
    format_group_member_record,
    string_match_rank,
    tool_principal_scope,
)
from backend.services.agent.tool_args.read import ListGroupsArgs
from backend.services.agent.tool_results import error_result, format_lines
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult, ToolExecutionStatus
from backend.services.groups import build_group_summary, group_load_options


def list_groups(context: ToolContext, args: ListGroupsArgs) -> ToolExecutionResult:
    _principal_name, principal_user_id, _principal_is_admin = tool_principal_scope(context)

    if args.group_id is not None:
        if principal_user_id is None:
            return error_result("no group matched group_id", details={"group_id": args.group_id})
        matches = find_groups_by_id(context.db, group_id=args.group_id, owner_user_id=principal_user_id)
        if not matches:
            return error_result("no group matched group_id", details={"group_id": args.group_id})
        if len(matches) > 1:
            return error_result(
                "ambiguous group_id matched multiple groups; retry with one of the candidate ids",
                details=group_id_ambiguity_details(context.db, matches, group_id=args.group_id),
            )

        record = group_detail_public_record(context.db, matches[0])
        output_json = {
            "status": "OK",
            "summary": f"returned details for group {record['group_id']}",
            "group": record,
        }
        members_text = "; ".join(
            format_group_member_record(member) for member in record.get("members", [])
        ) or "(none)"
        return ToolExecutionResult(
            output_text=format_lines(
                [
                    "OK",
                    f"summary: returned details for group {record['group_id']}",
                    f"group: {record['group_id']} {record['name']} ({record['source']})",
                    (
                        "stats: "
                        f"members={record.get('member_count')} "
                        f"range={record.get('first_occurred_at') or '-'} to {record.get('last_occurred_at') or '-'}"
                    ),
                    f"members: {members_text}",
                ]
            ),
            output_json=output_json,
            status=ToolExecutionStatus.OK,
        )

    groups = list(
        context.db.scalars(
            select(Group)
            .where(group_owner_condition(principal_user_id))
            .options(*group_load_options())
            .order_by(Group.created_at.desc())
        )
    )

    ranked: list[tuple[tuple[int, int, str], dict[str, Any]]] = []
    for group in groups:
        summary = build_group_summary(context.db, group)
        name_rank, name_ok = string_match_rank(summary.name, args.name)
        source_rank, source_ok = string_match_rank(
            summary.source.value,
            args.source.value if args.source is not None else None,
        )
        if not (name_ok and source_ok):
            continue
        record = group_summary_to_public_record(summary)
        ranked.append(((name_rank, source_rank, summary.name.lower()), record))

    ranked.sort(key=lambda pair: pair[0])
    total_available = len(ranked)
    records = [record for _, record in ranked[: args.limit]]
    groups_text = "; ".join(
        f"{row['group_id']} {row['name']} ({row['source']}, members={row['member_count']})"
        for row in records
    ) if records else "(none)"
    output_json = {
        "status": "OK",
        "summary": f"returned {len(records)} of {total_available} matching groups",
        "returned_count": len(records),
        "total_available": total_available,
        "groups": records,
    }
    return ToolExecutionResult(
        output_text=format_lines(
            [
                "OK",
                f"summary: returned {len(records)} of {total_available} matching groups",
                f"groups: {groups_text}",
            ]
        ),
        output_json=output_json,
        status=ToolExecutionStatus.OK,
    )
