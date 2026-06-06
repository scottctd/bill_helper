"""remove unused agent_change_items.rationale_text

Revision ID: 0044_remove_agent_change_item_rationale_text
Revises: 0043_add_import_workflow
Create Date: 2026-06-06
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0044_remove_agent_change_item_rationale_text"
down_revision: str | None = "0043_add_import_workflow"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("agent_change_items", "rationale_text")


def downgrade() -> None:
    op.add_column(
        "agent_change_items",
        sa.Column("rationale_text", sa.Text(), nullable=False, server_default=""),
    )
    op.alter_column("agent_change_items", "rationale_text", server_default=None)
