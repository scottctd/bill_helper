"""add agent session sources and max pdf pages

Revision ID: 0040_add_agent_session_sources
Revises: 0039_add_agent_run_approval_policy
Create Date: 2026-05-08
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0040_add_agent_session_sources"
down_revision: str | None = "0039_add_agent_run_approval_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("runtime_settings") as batch_op:
        batch_op.add_column(sa.Column("agent_max_pdf_pages", sa.Integer(), nullable=True))

    with op.batch_alter_table("agent_threads") as batch_op:
        batch_op.add_column(sa.Column("summary", sa.Text(), nullable=True))

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
    op.create_index(
        "ix_agent_session_sources_thread_id",
        "agent_session_sources",
        ["thread_id"],
        unique=False,
    )
    op.create_index(
        "ix_agent_session_sources_user_file_id",
        "agent_session_sources",
        ["user_file_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_agent_session_sources_user_file_id", table_name="agent_session_sources")
    op.drop_index("ix_agent_session_sources_thread_id", table_name="agent_session_sources")
    op.drop_table("agent_session_sources")

    with op.batch_alter_table("agent_threads") as batch_op:
        batch_op.drop_column("summary")

    with op.batch_alter_table("runtime_settings") as batch_op:
        batch_op.drop_column("agent_max_pdf_pages")
