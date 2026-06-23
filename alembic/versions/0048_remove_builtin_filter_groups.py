"""remove built-in filter groups

Revision ID: 0048_remove_builtin_filter_groups
Revises: 0047_entry_category_schedule
Create Date: 2026-06-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0048_remove_builtin_filter_groups"
down_revision: str | Sequence[str] | None = "0047_entry_category_schedule"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("DELETE FROM filter_groups WHERE is_default = :is_default").bindparams(is_default=True))


def downgrade() -> None:
    # Built-in definitions are intentionally not restored. Users can create
    # equivalent custom filter groups when they need overlapping cross-cuts.
    pass
