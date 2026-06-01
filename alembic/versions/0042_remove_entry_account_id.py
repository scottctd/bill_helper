"""remove legacy entries.account_id after entity-link backfill

Revision ID: 0042_remove_entry_account_id
Revises: 0041_add_agent_run_event_reasoning_duration_ms
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0042_remove_entry_account_id"
down_revision: str | None = "0041_add_agent_run_event_reasoning_duration_ms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _assert_no_ambiguous_transfer_rows(bind: sa.engine.Connection) -> None:
    ambiguous_count = bind.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM entries
            WHERE account_id IS NOT NULL
              AND from_entity_id IS NULL
              AND to_entity_id IS NULL
              AND kind = 'TRANSFER'
            """
        )
    ).scalar_one()
    if int(ambiguous_count or 0) > 0:
        raise RuntimeError(
            "Cannot drop entries.account_id: "
            f"{ambiguous_count} TRANSFER row(s) have account_id but no from/to entity links."
        )


def _assert_no_unlinked_account_rows(bind: sa.engine.Connection) -> None:
    unlinked_count = bind.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM entries
            WHERE account_id IS NOT NULL
              AND from_entity_id IS NULL
              AND to_entity_id IS NULL
            """
        )
    ).scalar_one()
    if int(unlinked_count or 0) > 0:
        raise RuntimeError(
            "Cannot drop entries.account_id: "
            f"{unlinked_count} row(s) still have account_id without from/to entity links."
        )


def upgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            UPDATE entries
            SET from_entity_id = account_id
            WHERE account_id IS NOT NULL
              AND from_entity_id IS NULL
              AND kind = 'EXPENSE'
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE entries
            SET to_entity_id = account_id
            WHERE account_id IS NOT NULL
              AND to_entity_id IS NULL
              AND kind = 'INCOME'
            """
        )
    )

    _assert_no_ambiguous_transfer_rows(bind)
    _assert_no_unlinked_account_rows(bind)

    with op.batch_alter_table("entries") as batch_op:
        batch_op.drop_index("ix_entries_account_id")
        batch_op.drop_column("account_id")


def downgrade() -> None:
    with op.batch_alter_table("entries") as batch_op:
        batch_op.add_column(sa.Column("account_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "entries_account_id_fkey",
            "accounts",
            ["account_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_entries_account_id", ["account_id"], unique=False)
