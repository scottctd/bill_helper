# CALLING SPEC:
# - Purpose: validate and apply the one-time legacy conversation backfill plan.
# - Inputs: LegacyAgentSnapshot, HarnessBackfillPlan, and migration connection.
# - Outputs: validation errors or inserted harness-first rows.
# - Side effects: inserts rows into newly created harness-first agent tables.
from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.services.agent.legacy_transcript_backfill import (
    HarnessBackfillPlan,
    LegacyAgentSnapshot,
)


def validate_harness_backfill(
    snapshot: LegacyAgentSnapshot,
    plan: HarnessBackfillPlan,
) -> None:
    """Refuse a destructive migration unless every conversation row can be ported."""
    planned_thread_ids = {thread.id for thread in plan.threads}
    missing_threads = {thread.id for thread in snapshot.threads} - planned_thread_ids
    if missing_threads:
        raise RuntimeError(f"Cannot migrate: unported agent threads: {sorted(missing_threads)}")

    planned_run_ids = {str(run["id"]) for run in plan.runs}
    missing_runs = {run.id for run in snapshot.runs} - planned_run_ids
    if missing_runs:
        raise RuntimeError(f"Cannot migrate: unported agent runs: {sorted(missing_runs)}")

    planned_message_ids = {message.id for message in plan.transcript_messages}
    missing_messages = {message.id for message in snapshot.messages} - planned_message_ids
    if missing_messages:
        raise RuntimeError(
            "Cannot migrate without losing legacy conversation messages: "
            f"{sorted(missing_messages)}"
        )

    planned_attachment_ids = {attachment.id for attachment in plan.transcript_attachments}
    missing_attachments = {attachment.id for attachment in snapshot.attachments} - planned_attachment_ids
    if missing_attachments:
        raise RuntimeError(
            "Cannot migrate without losing legacy conversation attachments: "
            f"{sorted(missing_attachments)}"
        )

    planned_tool_call_ids = {str(tool_call["id"]) for tool_call in plan.tool_calls}
    missing_tool_calls = {tool_call.id for tool_call in snapshot.tool_calls} - planned_tool_call_ids
    if missing_tool_calls:
        raise RuntimeError(
            "Cannot migrate without losing legacy tool calls: "
            f"{sorted(missing_tool_calls)}"
        )

    planned_event_ids = {str(event["id"]) for event in plan.events}
    missing_events = {event.id for event in snapshot.events} - planned_event_ids
    if missing_events:
        raise RuntimeError(
            "Cannot migrate without losing legacy run events: "
            f"{sorted(missing_events)}"
        )

    planned_source_ids = {source.id for source in plan.session_sources}
    missing_sources = {source.id for source in snapshot.session_sources} - planned_source_ids
    if missing_sources:
        raise RuntimeError(f"Cannot migrate: unported session sources: {sorted(missing_sources)}")

    planned_change_ids = {item.id for item in plan.change_items}
    missing_changes = {item.id for item in snapshot.change_items} - planned_change_ids
    if missing_changes:
        raise RuntimeError(f"Cannot migrate: unported change items: {sorted(missing_changes)}")

    planned_review_ids = {action.id for action in plan.review_actions}
    missing_reviews = {action.id for action in snapshot.review_actions} - planned_review_ids
    if missing_reviews:
        raise RuntimeError(f"Cannot migrate: unported review actions: {sorted(missing_reviews)}")


def apply_harness_backfill(connection: Connection, plan: HarnessBackfillPlan) -> None:
    for thread in plan.threads:
        connection.execute(
            text(
                """
                INSERT INTO agent_threads
                    (id, owner_user_id, title, summary, created_at, updated_at)
                VALUES
                    (:id, :owner_user_id, :title, :summary, :created_at, :updated_at)
                """
            ),
            {
                "id": thread.id,
                "owner_user_id": thread.owner_user_id,
                "title": thread.title,
                "summary": thread.summary,
                "created_at": thread.created_at,
                "updated_at": thread.updated_at,
            },
        )

    for run_row in plan.runs:
        connection.execute(
            text(
                """
                INSERT INTO agent_runs (
                    id, thread_id, turn_index, status, model_name, principal_user_id,
                    principal_user_name, metadata_json, origin, approval_policy, max_steps,
                    final_transcript_message_id, input_tokens, output_tokens, cache_read_tokens,
                    cache_write_tokens, input_cost_usd, output_cost_usd, total_cost_usd,
                    error_code, error_detail, stop_requested, created_at, completed_at
                ) VALUES (
                    :id, :thread_id, :turn_index, :status, :model_name, :principal_user_id,
                    :principal_user_name, :metadata_json, :origin, :approval_policy, :max_steps,
                    :final_transcript_message_id, :input_tokens, :output_tokens, :cache_read_tokens,
                    :cache_write_tokens, :input_cost_usd, :output_cost_usd, :total_cost_usd,
                    :error_code, :error_detail, :stop_requested, :created_at, :completed_at
                )
                """
            ),
            run_row | {"metadata_json": json.dumps(run_row["metadata_json"])},
        )

    for row in plan.transcript_messages:
        connection.execute(
            text(
                """
                INSERT INTO agent_transcript_messages (
                    id, run_id, sequence_index, role, content_json, reasoning_text,
                    tool_request_id, tool_name, created_at
                ) VALUES (
                    :id, :run_id, :sequence_index, :role, :content_json, :reasoning_text,
                    :tool_request_id, :tool_name, :created_at
                )
                """
            ),
            {
                "id": row.id,
                "run_id": row.run_id,
                "sequence_index": row.sequence_index,
                "role": row.role,
                "content_json": json.dumps(row.content_json),
                "reasoning_text": row.reasoning_text,
                "tool_request_id": row.tool_request_id,
                "tool_name": row.tool_name,
                "created_at": row.created_at,
            },
        )

    for attachment in plan.transcript_attachments:
        connection.execute(
            text(
                """
                INSERT INTO agent_transcript_attachments
                    (id, transcript_message_id, user_file_id, created_at)
                VALUES
                    (:id, :transcript_message_id, :user_file_id, :created_at)
                """
            ),
            {
                "id": attachment.id,
                "transcript_message_id": attachment.message_id,
                "user_file_id": attachment.user_file_id,
                "created_at": attachment.created_at,
            },
        )

    for step in plan.steps:
        connection.execute(
            text(
                """
                INSERT INTO agent_steps (
                    id, run_id, step_index, assistant_transcript_message_id, status,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                    finish_reason, latency_ms, diagnostic_json, created_at
                ) VALUES (
                    :id, :run_id, :step_index, :assistant_transcript_message_id, :status,
                    :input_tokens, :output_tokens, :cache_read_tokens, :cache_write_tokens,
                    :finish_reason, :latency_ms, :diagnostic_json, :created_at
                )
                """
            ),
            step | {"diagnostic_json": json.dumps(step["diagnostic_json"])},
        )

    for tool_call in plan.tool_calls:
        connection.execute(
            text(
                """
                INSERT INTO agent_tool_calls (
                    id, run_id, step_id, call_index, tool_request_id, tool_name,
                    arguments_json, status, result_content_json, error_code,
                    started_at, completed_at
                ) VALUES (
                    :id, :run_id, :step_id, :call_index, :tool_request_id, :tool_name,
                    :arguments_json, :status, :result_content_json, :error_code,
                    :started_at, :completed_at
                )
                """
            ),
            tool_call
            | {
                "arguments_json": json.dumps(tool_call["arguments_json"]),
                "result_content_json": json.dumps(tool_call["result_content_json"]),
            },
        )

    for event in plan.events:
        connection.execute(
            text(
                """
                INSERT INTO agent_run_events (
                    id, run_id, sequence_index, event_type, payload_json, created_at
                ) VALUES (
                    :id, :run_id, :sequence_index, :event_type, :payload_json, :created_at
                )
                """
            ),
            event | {"payload_json": json.dumps(event["payload_json"])},
        )

    for source in plan.session_sources:
        connection.execute(
            text(
                """
                INSERT INTO agent_session_sources
                    (id, thread_id, user_file_id, note, created_at)
                VALUES
                    (:id, :thread_id, :user_file_id, :note, :created_at)
                """
            ),
            {
                "id": source.id,
                "thread_id": source.thread_id,
                "user_file_id": source.user_file_id,
                "note": source.note,
                "created_at": source.created_at,
            },
        )

    for item in plan.change_items:
        connection.execute(
            text(
                """
                INSERT INTO agent_change_items (
                    id, run_id, change_type, payload_json, status, review_note,
                    applied_resource_type, applied_resource_id, created_at, updated_at
                ) VALUES (
                    :id, :run_id, :change_type, :payload_json, :status, :review_note,
                    :applied_resource_type, :applied_resource_id, :created_at, :updated_at
                )
                """
            ),
            {
                "id": item.id,
                "run_id": item.run_id,
                "change_type": item.change_type,
                "payload_json": json.dumps(item.payload_json),
                "status": item.status,
                "review_note": item.review_note,
                "applied_resource_type": item.applied_resource_type,
                "applied_resource_id": item.applied_resource_id,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            },
        )

    for action in plan.review_actions:
        connection.execute(
            text(
                """
                INSERT INTO agent_review_actions
                    (id, change_item_id, action, actor, note, created_at)
                VALUES
                    (:id, :change_item_id, :action, :actor, :note, :created_at)
                """
            ),
            {
                "id": action.id,
                "change_item_id": action.change_item_id,
                "action": action.action,
                "actor": action.actor,
                "note": action.note,
                "created_at": action.created_at,
            },
        )
