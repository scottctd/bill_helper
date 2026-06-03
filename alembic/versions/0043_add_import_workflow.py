"""add import workflow tables

Revision ID: 0043_add_import_workflow
Revises: 0042_remove_entry_account_id
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0043_add_import_workflow"
down_revision: str | None = "0042_remove_entry_account_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "paused",
                "completed",
                "failed",
                "cancelled",
                name="importjobstatus",
            ),
            nullable=False,
        ),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("approval_policy", sa.String(length=32), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("total_tasks", sa.Integer(), nullable=False),
        sa.Column("completed_tasks", sa.Integer(), nullable=False),
        sa.Column("failed_tasks", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_jobs_owner_user_id", "import_jobs", ["owner_user_id"], unique=False)
    op.create_index("ix_import_jobs_status", "import_jobs", ["status"], unique=False)

    op.create_table(
        "import_tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("job_id", sa.String(length=36), nullable=False),
        sa.Column("thread_id", sa.String(length=36), nullable=False),
        sa.Column("source_user_file_id", sa.String(length=36), nullable=True),
        sa.Column("source_sha256", sa.String(length=64), nullable=True),
        sa.Column("source_label", sa.String(length=1024), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "completed",
                "failed",
                "cancelled",
                name="importtaskstatus",
            ),
            nullable=False,
        ),
        sa.Column("active_run_id", sa.String(length=36), nullable=True),
        sa.Column("error_text", sa.Text(), nullable=True),
        sa.Column("sequence_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["import_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["agent_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_user_file_id"], ["user_files.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_tasks_job_id", "import_tasks", ["job_id"], unique=False)
    op.create_index("ix_import_tasks_thread_id", "import_tasks", ["thread_id"], unique=False)
    op.create_index("ix_import_tasks_source_sha256", "import_tasks", ["source_sha256"], unique=False)
    op.create_index("ix_import_tasks_status", "import_tasks", ["status"], unique=False)
    op.create_index("ix_import_tasks_active_run_id", "import_tasks", ["active_run_id"], unique=False)
    op.create_index(
        "ix_import_tasks_source_user_file_id",
        "import_tasks",
        ["source_user_file_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_import_tasks_source_user_file_id", table_name="import_tasks")
    op.drop_index("ix_import_tasks_active_run_id", table_name="import_tasks")
    op.drop_index("ix_import_tasks_status", table_name="import_tasks")
    op.drop_index("ix_import_tasks_source_sha256", table_name="import_tasks")
    op.drop_index("ix_import_tasks_thread_id", table_name="import_tasks")
    op.drop_index("ix_import_tasks_job_id", table_name="import_tasks")
    op.drop_table("import_tasks")

    op.drop_index("ix_import_jobs_status", table_name="import_jobs")
    op.drop_index("ix_import_jobs_owner_user_id", table_name="import_jobs")
    op.drop_table("import_jobs")
