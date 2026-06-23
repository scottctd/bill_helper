"""unify entry groups and filter groups

Revision ID: 0049_unified_groups
Revises: 0048_remove_builtin_filter_groups
Create Date: 2026-06-22
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision: str = "0049_unified_groups"
down_revision: str | Sequence[str] | None = "0048_remove_builtin_filter_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

group_source_enum = sa.Enum("manual", "rule", name="groupsource")
group_member_override_enum = sa.Enum("include", "exclude", name="groupmemberoverride")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        raise NotImplementedError("Migration 0049 currently supports SQLite only.")

    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "groups" in existing_tables:
        return

    bind.exec_driver_sql("PRAGMA foreign_keys=OFF")
    try:
        now = datetime.now(timezone.utc)
        group_source_enum.create(bind, checkfirst=True)
        group_member_override_enum.create(bind, checkfirst=True)

        op.create_table(
            "groups",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("color", sa.String(length=20), nullable=True),
            sa.Column("source", group_source_enum, nullable=False),
            sa.Column("definition_json", sa.JSON(), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index("ix_groups_owner_user_id", "groups", ["owner_user_id"])
        op.create_index("ix_groups_source", "groups", ["source"])

        op.create_table(
            "group_members",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("group_id", sa.String(length=36), nullable=False),
            sa.Column("entry_id", sa.String(length=36), nullable=False),
            sa.Column("override", group_member_override_enum, nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["entry_id"], ["entries.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("group_id", "entry_id", name="uq_group_members_group_entry"),
        )
        op.create_index("ix_group_members_group_id", "group_members", ["group_id"])
        op.create_index("ix_group_members_entry_id", "group_members", ["entry_id"])
        op.create_index("ix_group_members_override", "group_members", ["override"])

        migrated_groups: list[dict[str, object]] = []
        migrated_members: list[dict[str, object]] = []

        if "entry_groups" in existing_tables:
            entry_group_rows = [
                dict(row)
                for row in bind.execute(sa.text("SELECT * FROM entry_groups")).mappings()
            ]
            member_rows = [
                dict(row)
                for row in bind.execute(sa.text("SELECT * FROM entry_group_members")).mappings()
            ]
            members_by_group: dict[str, list[dict[str, object]]] = defaultdict(list)
            for member in member_rows:
                members_by_group[str(member["group_id"])].append(member)

            child_group_ids = {
                str(member["child_group_id"])
                for member in member_rows
                if member.get("child_group_id") is not None
            }
            parent_by_child: dict[str, str] = {}
            for member in member_rows:
                if member.get("child_group_id") is not None:
                    parent_by_child[str(member["child_group_id"])] = str(member["group_id"])

            for row in entry_group_rows:
                group_id = str(row["id"])
                parent_id = parent_by_child.get(group_id)
                parent_name = None
                if parent_id is not None:
                    parent_row = next(
                        (candidate for candidate in entry_group_rows if str(candidate["id"]) == parent_id),
                        None,
                    )
                    if parent_row is not None:
                        parent_name = str(parent_row["name"])
                name = str(row["name"])
                if parent_name:
                    name = f"{parent_name} / {name}"
                migrated_groups.append(
                    {
                        "id": group_id,
                        "owner_user_id": row["owner_user_id"],
                        "name": name[:120],
                        "description": None,
                        "color": None,
                        "source": "manual",
                        "definition_json": None,
                        "position": 0,
                        "created_at": row.get("created_at") or now,
                        "updated_at": row.get("updated_at") or now,
                    }
                )
                direct_members = sorted(
                    members_by_group.get(group_id, []),
                    key=lambda member: (
                        member.get("position", 0),
                        member.get("created_at"),
                        str(member["id"]),
                    ),
                )
                for member in direct_members:
                    if member.get("entry_id") is None:
                        continue
                    migrated_members.append(
                        {
                            "id": str(member["id"]),
                            "group_id": group_id,
                            "entry_id": str(member["entry_id"]),
                            "override": None,
                            "position": member.get("position", 0),
                            "created_at": member.get("created_at") or now,
                            "updated_at": member.get("updated_at") or now,
                        }
                    )

        if "filter_groups" in existing_tables:
            filter_rows = [
                dict(row)
                for row in bind.execute(sa.text("SELECT * FROM filter_groups")).mappings()
            ]
            for row in filter_rows:
                migrated_groups.append(
                    {
                        "id": str(row["id"]),
                        "owner_user_id": row["owner_user_id"],
                        "name": str(row["name"])[:120],
                        "description": row.get("description"),
                        "color": row.get("color"),
                        "source": "rule",
                        "definition_json": row.get("definition_json"),
                        "position": row.get("position", 0),
                        "created_at": row.get("created_at") or now,
                        "updated_at": row.get("updated_at") or now,
                    }
                )

        if migrated_groups:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO groups
                      (
                        id,
                        owner_user_id,
                        name,
                        description,
                        color,
                        source,
                        definition_json,
                        position,
                        created_at,
                        updated_at
                      )
                    VALUES
                      (
                        :id,
                        :owner_user_id,
                        :name,
                        :description,
                        :color,
                        :source,
                        :definition_json,
                        :position,
                        :created_at,
                        :updated_at
                      )
                    """
                ),
                migrated_groups,
            )

        if migrated_members:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO group_members
                      (
                        id,
                        group_id,
                        entry_id,
                        override,
                        position,
                        created_at,
                        updated_at
                      )
                    VALUES
                      (
                        :id,
                        :group_id,
                        :entry_id,
                        :override,
                        :position,
                        :created_at,
                        :updated_at
                      )
                    """
                ),
                migrated_members,
            )

        if "entry_group_members" in existing_tables:
            op.drop_table("entry_group_members")
        if "entry_groups" in existing_tables:
            op.drop_table("entry_groups")
        if "filter_groups" in existing_tables:
            op.drop_table("filter_groups")
    finally:
        bind.exec_driver_sql("PRAGMA foreign_keys=ON")


def downgrade() -> None:
    raise NotImplementedError("Downgrade is not supported for migration 0049_unified_groups.")
