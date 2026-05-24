"""add agent run event reasoning duration ms

Revision ID: 0041_add_agent_run_event_reasoning_duration_ms
Revises: 0040_add_agent_session_sources
Create Date: 2026-05-24
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0041_add_agent_run_event_reasoning_duration_ms"
down_revision: str | None = "0040_add_agent_session_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("agent_run_events") as batch_op:
        batch_op.add_column(sa.Column("reasoning_duration_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("agent_run_events") as batch_op:
        batch_op.drop_column("reasoning_duration_ms")
