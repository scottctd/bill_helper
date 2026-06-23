"""entry category taxonomy + lifecycle column

Adds a per-entry lifecycle enum column (fixed/day_to_day/one_time) and an
`entry_category` taxonomy (applies_to=entry, hierarchical depth=1). Backfills
each entry's category (from its current category tag) and lifecycle (from the
one_time tag plus the category leaf default), then deletes the migrated
category tags and the one_time tag and dissolves the lifecycle/income filter
groups.

Destructive: deleted category/one_time tags and dissolved filter groups are
NOT restored on downgrade — restore from the pre-migration DB backup instead.

Revision ID: 0046_entry_category_lifecycle
Revises: 0045_agent_harness_first_schema
Create Date: 2026-06-20
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision: str = "0046_entry_category_lifecycle"
down_revision: str | Sequence[str] | None = "0045_agent_harness_first_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


entry_lifecycle_enum = sa.Enum("FIXED", "DAY_TO_DAY", "ONE_TIME", name="entrylifecycle")

ENTRY_CATEGORY_TAXONOMY_KEY = "entry_category"

# (parent_name, parent_default_lifecycle, [(child_name, child_default_lifecycle), ...])
ENTRY_CATEGORY_TREE: list[tuple[str, str | None, list[tuple[str, str]]]] = [
    ("housing", "fixed", [
        ("utilities", "fixed"), ("internet_mobile", "fixed"),
        ("home", "day_to_day"), ("home_maintenance", "one_time"),
    ]),
    ("food_drink", None, [
        ("grocery", "day_to_day"), ("dining_out", "day_to_day"),
        ("coffee_snacks", "day_to_day"), ("alcohol_bars", "day_to_day"),
    ]),
    ("transport", None, [
        ("transportation", "day_to_day"), ("fuel", "day_to_day"), ("auto", "day_to_day"),
    ]),
    ("health", None, [
        ("pharmacy", "day_to_day"), ("health_medical", "day_to_day"),
    ]),
    ("shopping_lifestyle", None, [
        ("shopping", "day_to_day"), ("clothing", "day_to_day"),
        ("personal_care", "day_to_day"), ("entertainment", "day_to_day"),
        ("pets", "day_to_day"), ("electronics", "one_time"),
        ("gifts", "one_time"), ("fitness", "fixed"),
    ]),
    ("subscriptions", "fixed", []),
    ("financial", None, [
        ("debt_payment", "fixed"), ("interest_expense", "fixed"),
        ("taxes", "fixed"), ("insurance", "fixed"),
        ("fees", "day_to_day"), ("bank_fees", "day_to_day"),
        ("api_usage", "day_to_day"),
    ]),
    ("education_family", None, [
        ("education", "one_time"), ("kids_childcare", "fixed"),
    ]),
    ("giving", None, [
        ("donations_charity", "one_time"),
    ]),
    ("income", "fixed", [
        ("salary_wages", "fixed"), ("bonus", "one_time"),
        ("investment_gains", "one_time"), ("gifts_received", "one_time"),
        ("other_income", "day_to_day"), ("business_income", "fixed"),
        ("dividends", "one_time"), ("interest_income", "fixed"),
    ]),
    ("refunds", None, [
        ("refund", "one_time"), ("reimbursement", "one_time"), ("tax_refund", "one_time"),
    ]),
]

# Tags whose name collides with their parent name -> assign to the parent term directly.
PARENT_DIRECT_TAGS = {"housing", "subscriptions", "income"}

ONE_TIME_TAG = "one_time"
# Vestigial 0-use placeholder tags that conflict conceptually with the new model.
VESTIGIAL_TAGS = ("uncategorized",)
DISSOLVED_FILTER_GROUP_KEYS = ("day_to_day", "one_time", "fixed", "untagged", "salary", "other_income")


def _build_tag_to_category() -> dict[str, tuple[str, str | None, str | None]]:
    """tag_name -> (parent_name, child_name|None, default_lifecycle)."""
    mapping: dict[str, tuple[str, str | None, str | None]] = {}
    for parent, parent_default, children in ENTRY_CATEGORY_TREE:
        for child, child_default in children:
            mapping[child] = (parent, child, child_default)
    for tag in PARENT_DIRECT_TAGS:
        parent_default = next(pd for p, pd, _ in ENTRY_CATEGORY_TREE if p == tag)
        mapping[tag] = (tag, None, parent_default)
    return mapping


CATEGORY_TAG_NAMES = set(_build_tag_to_category().keys())


def _metadata_json(lifecycle: str | None) -> str | None:
    if lifecycle is None:
        return None
    return f'{{"default_lifecycle": "{lifecycle}"}}'


def _seed_category_tree(bind: sa.engine.Connection, owner_user_id: str, now: datetime) -> tuple[str, dict[str, str]]:
    """Create the entry_category taxonomy (if missing) + seed the tree; return (taxonomy_id, name->term_id)."""
    row = bind.execute(
        sa.text(
            "SELECT id FROM taxonomies WHERE owner_user_id = :oid AND key = :key LIMIT 1"
        ),
        {"oid": owner_user_id, "key": ENTRY_CATEGORY_TAXONOMY_KEY},
    ).first()
    if row:
        taxonomy_id = str(row[0])
    else:
        taxonomy_id = str(uuid4())
        bind.execute(
            sa.text(
                """
                INSERT INTO taxonomies
                    (id, owner_user_id, key, applies_to, cardinality, display_name, created_at, updated_at)
                VALUES (:id, :oid, :key, 'entry', 'single', 'Entry Categories', :now, :now)
                """
            ),
            {"id": taxonomy_id, "oid": owner_user_id, "key": ENTRY_CATEGORY_TAXONOMY_KEY, "now": now},
        )

    name_to_id: dict[str, str] = {
        str(name): str(term_id)
        for name, term_id in bind.execute(
            sa.text("SELECT name, id FROM taxonomy_terms WHERE taxonomy_id = :tid"),
            {"tid": taxonomy_id},
        ).all()
    }

    def _ensure_term(name: str, parent_id: str | None, lifecycle: str | None) -> str:
        if name in name_to_id:
            return name_to_id[name]
        term_id = str(uuid4())
        bind.execute(
            sa.text(
                """
                INSERT INTO taxonomy_terms
                    (id, taxonomy_id, name, normalized_name, parent_term_id, metadata_json, created_at, updated_at)
                VALUES (:id, :tid, :name, :name, :pid, :metadata, :now, :now)
                """
            ),
            {
                "id": term_id, "tid": taxonomy_id, "name": name,
                "pid": parent_id, "metadata": _metadata_json(lifecycle), "now": now,
            },
        )
        name_to_id[name] = term_id
        return term_id

    for parent, parent_default, _children in ENTRY_CATEGORY_TREE:
        _ensure_term(parent, None, parent_default)
    for parent, _parent_default, children in ENTRY_CATEGORY_TREE:
        parent_id = name_to_id[parent]
        for child, child_default in children:
            _ensure_term(child, parent_id, child_default)

    return taxonomy_id, name_to_id


def _backfill_entries(
    bind: sa.engine.Connection,
    now: datetime,
    taxonomy_by_owner: dict[str, str],
    term_id_by_owner: dict[str, dict[str, str]],
) -> None:
    tag_to_category = _build_tag_to_category()

    entries = bind.execute(
        sa.text("SELECT id, owner_user_id FROM entries WHERE is_deleted = 0")
    ).all()
    tag_rows = bind.execute(
        sa.text(
            "SELECT et.entry_id, t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id"
        )
    ).all()
    tags_by_entry: dict[str, set[str]] = defaultdict(set)
    for entry_id, tag_name in tag_rows:
        tags_by_entry[str(entry_id)].add(str(tag_name))

    for entry_id, owner_user_id in entries:
        entry_id = str(entry_id)
        owner_user_id = str(owner_user_id)
        tag_names = tags_by_entry.get(entry_id, set())

        category_tags = sorted(name for name in tag_names if name in tag_to_category)
        chosen = category_tags[0] if category_tags else None

        if chosen is not None:
            _parent, child, default_lifecycle = tag_to_category[chosen]
            term_name = child if child is not None else _parent
            term_id = term_id_by_owner.get(owner_user_id, {}).get(term_name)
            taxonomy_id = taxonomy_by_owner.get(owner_user_id)
            if term_id is not None and taxonomy_id is not None:
                bind.execute(
                    sa.text(
                        "DELETE FROM taxonomy_assignments "
                        "WHERE taxonomy_id = :tid AND subject_type = 'entry' AND subject_id = :eid"
                    ),
                    {"tid": taxonomy_id, "eid": entry_id},
                )
                bind.execute(
                    sa.text(
                        """
                        INSERT INTO taxonomy_assignments
                            (id, taxonomy_id, term_id, subject_type, subject_id, position, created_at, updated_at)
                        VALUES (:id, :tid, :term_id, 'entry', :eid, 0, :now, :now)
                        """
                    ),
                    {
                        "id": str(uuid4()), "tid": taxonomy_id, "term_id": term_id,
                        "eid": entry_id, "now": now,
                    },
                )
            lifecycle: str | None = "one_time" if ONE_TIME_TAG in tag_names else default_lifecycle
        else:
            lifecycle = "one_time" if ONE_TIME_TAG in tag_names else None

        if lifecycle is not None:
            bind.execute(
                sa.text("UPDATE entries SET lifecycle = :lc WHERE id = :eid"),
                {"lc": lifecycle.upper(), "eid": entry_id},
            )


def _delete_migrated_tags(bind: sa.engine.Connection) -> None:
    names = list(CATEGORY_TAG_NAMES | {ONE_TIME_TAG} | set(VESTIGIAL_TAGS))
    bind.execute(
        sa.text(
            "DELETE FROM entry_tags WHERE tag_id IN (SELECT id FROM tags WHERE name IN :names)"
        ).bindparams(sa.bindparam("names", expanding=True)),
        {"names": names},
    )
    bind.execute(
        sa.text("DELETE FROM tags WHERE name IN :names").bindparams(sa.bindparam("names", expanding=True)),
        {"names": names},
    )


def _delete_dissolved_filter_groups(bind: sa.engine.Connection) -> None:
    bind.execute(
        sa.text("DELETE FROM filter_groups WHERE key IN :keys").bindparams(sa.bindparam("keys", expanding=True)),
        {"keys": list(DISSOLVED_FILTER_GROUP_KEYS)},
    )


def upgrade() -> None:
    bind = op.get_bind()

    with op.batch_alter_table("entries") as batch_op:
        batch_op.add_column(sa.Column("lifecycle", entry_lifecycle_enum, nullable=True))
        batch_op.create_index("ix_entries_lifecycle", ["lifecycle"])

    now = datetime.now(timezone.utc)

    taxonomy_by_owner: dict[str, str] = {}
    term_id_by_owner: dict[str, dict[str, str]] = {}
    for (user_id,) in bind.execute(sa.text("SELECT id FROM users")).all():
        taxonomy_id, name_to_id = _seed_category_tree(bind, str(user_id), now)
        taxonomy_by_owner[str(user_id)] = taxonomy_id
        term_id_by_owner[str(user_id)] = name_to_id

    _backfill_entries(bind, now, taxonomy_by_owner, term_id_by_owner)
    _delete_migrated_tags(bind)
    _delete_dissolved_filter_groups(bind)


def downgrade() -> None:
    with op.batch_alter_table("entries") as batch_op:
        batch_op.drop_index("ix_entries_lifecycle")
        batch_op.drop_column("lifecycle")

    # Remove the entry_category taxonomy and its terms/assignments (cascade).
    op.execute(sa.text("DELETE FROM taxonomies WHERE key = 'entry_category'"))
    entry_lifecycle_enum.drop(op.get_bind(), checkfirst=True)
