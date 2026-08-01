"""add per-model reasoning efforts to runtime settings

Revision ID: 0050_add_agent_model_reasoning_efforts
Revises: 0049_unified_groups
Create Date: 2026-07-31
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0050_add_agent_model_reasoning_efforts"
down_revision: str | None = "0049_unified_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runtime_settings",
        sa.Column("agent_model_reasoning_efforts", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("runtime_settings", "agent_model_reasoning_efforts")
