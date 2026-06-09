"""agent harness-first schema with legacy transcript port

Revision ID: 0045_agent_harness_first_schema
Revises: 0044_remove_agent_change_item_rationale_text
Create Date: 2026-06-07
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0045_agent_harness_first_schema"
down_revision: str | None = "0044_remove_agent_change_item_rationale_text"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _assert_no_running_runs(connection) -> None:
    inspector = sa.inspect(connection)
    if "agent_runs" not in inspector.get_table_names():
        return
    running = connection.execute(
        sa.text("SELECT COUNT(*) FROM agent_runs WHERE UPPER(status) = 'RUNNING'")
    ).scalar_one()
    if running and int(running) > 0:
        raise RuntimeError(
            "Cannot migrate: agent runs are still RUNNING. "
            "Wait for or interrupt active runs before upgrading."
        )


def _drop_legacy_agent_tables() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    drop_order = [
        "agent_review_actions",
        "agent_change_items",
        "agent_run_events",
        "agent_tool_calls",
        "agent_message_attachments",
        "agent_transcript_attachments",
        "agent_session_sources",
        "agent_steps",
        "agent_transcript_messages",
        "agent_runs",
        "agent_messages",
        "agent_threads",
    ]
    for table in drop_order:
        if table in existing:
            op.drop_table(table)


def _create_harness_tables() -> None:
    op.create_table(
        "agent_threads",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_threads_owner_user_id", "agent_threads", ["owner_user_id"])

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("thread_id", sa.String(length=36), nullable=True),
        sa.Column("turn_index", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "RUNNING",
                "COMPLETED",
                "INTERRUPTED",
                "MAX_STEPS",
                "FAILED",
                name="agentrunstatus",
            ),
            nullable=False,
        ),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("principal_user_id", sa.String(length=36), nullable=False),
        sa.Column("principal_user_name", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("origin", sa.String(length=64), nullable=False, server_default="app"),
        sa.Column("approval_policy", sa.String(length=32), nullable=False, server_default="default"),
        sa.Column("max_steps", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("final_transcript_message_id", sa.String(length=36), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=True),
        sa.Column("input_cost_usd", sa.Float(), nullable=True),
        sa.Column("output_cost_usd", sa.Float(), nullable=True),
        sa.Column("total_cost_usd", sa.Float(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["thread_id"], ["agent_threads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("thread_id", "turn_index", name="uq_agent_runs_thread_turn"),
    )
    op.create_index("ix_agent_runs_thread_id", "agent_runs", ["thread_id"])
    op.create_index("ix_agent_runs_status", "agent_runs", ["status"])
    op.create_index("ix_agent_runs_created_at", "agent_runs", ["created_at"])

    op.create_table(
        "agent_transcript_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("sequence_index", sa.Integer(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("SYSTEM", "USER", "ASSISTANT", "TOOL", name="agenttranscriptrole"),
            nullable=False,
        ),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("reasoning_text", sa.Text(), nullable=True),
        sa.Column("tool_request_id", sa.String(length=255), nullable=True),
        sa.Column("tool_name", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence_index", name="uq_agent_transcript_run_sequence"),
    )
    op.create_index("ix_agent_transcript_messages_run_id", "agent_transcript_messages", ["run_id"])
    op.create_index("ix_agent_transcript_messages_role", "agent_transcript_messages", ["role"])

    op.create_table(
        "agent_transcript_attachments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("transcript_message_id", sa.String(length=36), nullable=False),
        sa.Column("user_file_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["transcript_message_id"], ["agent_transcript_messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_file_id"], ["user_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agent_transcript_attachments_message_id",
        "agent_transcript_attachments",
        ["transcript_message_id"],
    )

    op.create_table(
        "agent_steps",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("assistant_transcript_message_id", sa.String(length=36), nullable=False),
        sa.Column(
            "status",
            sa.Enum("RUNNING", "COMMITTED", "FAILED", name="agentstepstatus"),
            nullable=False,
        ),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=True),
        sa.Column("finish_reason", sa.String(length=64), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("diagnostic_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["assistant_transcript_message_id"],
            ["agent_transcript_messages.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "step_index", name="uq_agent_steps_run_step"),
    )
    op.create_index("ix_agent_steps_run_id", "agent_steps", ["run_id"])

    op.create_table(
        "agent_tool_calls",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("step_id", sa.String(length=36), nullable=False),
        sa.Column("call_index", sa.Integer(), nullable=False),
        sa.Column("tool_request_id", sa.String(length=255), nullable=False),
        sa.Column("tool_name", sa.String(length=128), nullable=False),
        sa.Column("arguments_json", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("QUEUED", "RUNNING", "OK", "ERROR", "CANCELLED", name="agenttoolcallstatus"),
            nullable=False,
        ),
        sa.Column("result_content_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["agent_steps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("step_id", "call_index", name="uq_agent_tool_calls_step_call"),
        sa.UniqueConstraint("run_id", "tool_request_id", name="uq_agent_tool_calls_run_request"),
    )
    op.create_index("ix_agent_tool_calls_run_id", "agent_tool_calls", ["run_id"])

    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("sequence_index", sa.Integer(), nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(
                "RUN_STARTED",
                "MODEL_REQUEST_STARTED",
                "MODEL_DECISION_COMMITTED",
                "TOOL_STARTED",
                "TOOL_FINISHED",
                "STEP_COMMITTED",
                "RUN_FINISHED",
                name="agentruneventtype",
            ),
            nullable=False,
        ),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence_index", name="uq_agent_run_events_run_sequence"),
    )
    op.create_index("ix_agent_run_events_run_id", "agent_run_events", ["run_id"])

    op.create_table(
        "agent_session_sources",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("thread_id", sa.String(length=36), nullable=False),
        sa.Column("user_file_id", sa.String(length=36), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["agent_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_file_id"], ["user_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("thread_id", "user_file_id", name="uq_agent_session_sources_thread_file"),
    )
    op.create_index("ix_agent_session_sources_thread_id", "agent_session_sources", ["thread_id"])

    op.create_table(
        "agent_change_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("change_type", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("applied_resource_type", sa.String(length=64), nullable=True),
        sa.Column("applied_resource_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_change_items_run_id", "agent_change_items", ["run_id"])

    op.create_table(
        "agent_review_actions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("change_item_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["change_item_id"], ["agent_change_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_review_actions_change_item_id", "agent_review_actions", ["change_item_id"])


def upgrade() -> None:
    from backend.services.agent.legacy_transcript_backfill import (
        export_legacy_agent_snapshot,
        plan_harness_backfill,
    )
    from backend.services.agent.legacy_transcript_backfill_apply import (
        apply_harness_backfill,
        validate_harness_backfill,
    )

    connection = op.get_bind()
    _assert_no_running_runs(connection)
    legacy_snapshot = export_legacy_agent_snapshot(connection)
    backfill_plan = plan_harness_backfill(legacy_snapshot)
    validate_harness_backfill(legacy_snapshot, backfill_plan)
    _drop_legacy_agent_tables()
    _create_harness_tables()
    apply_harness_backfill(connection, backfill_plan)


def downgrade() -> None:
    _drop_legacy_agent_tables()
