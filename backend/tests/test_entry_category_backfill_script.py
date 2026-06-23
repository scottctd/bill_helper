from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, text

from scripts.apply_entry_category_backfill import (
    apply_classifications,
    load_classifications,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def _upgrade_to_head(database_url: str) -> None:
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url)
    cfg.set_main_option("script_location", str(REPO_ROOT / "alembic"))
    command.upgrade(cfg, "head")


def _write_plan_files(
    tmp_path: Path,
    *,
    target_path: str = "food_drink/delivery_takeout",
) -> tuple[Path, Path, str]:
    entry_id = str(uuid4())
    input_path = tmp_path / "input.json"
    output_path = tmp_path / "output.json"
    input_path.write_text(
        json.dumps(
            {
                "signatures": [
                    {
                        "signature_id": "sig-0001",
                        "entry_ids": [entry_id],
                        "allowed_targets": [
                            "food_drink/restaurants",
                            "food_drink/delivery_takeout",
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    output_path.write_text(
        json.dumps(
            {
                "classifications": [
                    {
                        "signature_id": "sig-0001",
                        "target_path": target_path,
                        "confidence": "low",
                        "rationale": "The merchant is an explicit delivery service.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return input_path, output_path, entry_id


def test_load_classifications_rejects_target_outside_allowed_set(tmp_path):
    input_path, output_path, _entry_id = _write_plan_files(
        tmp_path,
        target_path="housing/internet",
    )

    with pytest.raises(ValueError, match="is not in"):
        load_classifications(input_path, output_path)


def test_apply_entry_category_backfill_supports_dry_run_and_apply(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'backfill.sqlite'}"
    _upgrade_to_head(database_url)
    engine = create_engine(database_url, future=True)
    input_path, output_path, entry_id = _write_plan_files(tmp_path)
    classifications = load_classifications(input_path, output_path)
    now = datetime.now(timezone.utc)

    with engine.begin() as connection:
        owner_user_id = str(
            connection.execute(
                text("SELECT id FROM users WHERE name = 'admin' LIMIT 1")
            ).scalar_one()
        )
        taxonomy_id, restaurant_term_id = connection.execute(
            text(
                """
                SELECT taxonomy.id, term.id
                FROM taxonomies AS taxonomy
                JOIN taxonomy_terms AS term ON term.taxonomy_id = taxonomy.id
                JOIN taxonomy_terms AS parent ON parent.id = term.parent_term_id
                WHERE taxonomy.owner_user_id = :owner_id
                  AND taxonomy.key = 'entry_category'
                  AND parent.name = 'food_drink'
                  AND term.name = 'restaurants'
                """
            ),
            {"owner_id": owner_user_id},
        ).one()
        connection.execute(
            text(
                """
                INSERT INTO entries (
                    id, kind, occurred_at, name, amount_minor, currency_code,
                    owner_user_id, owner, is_deleted, created_at, updated_at
                )
                VALUES (
                    :id, 'EXPENSE', '2026-06-01', 'Delivery order', 2500, 'CAD',
                    :owner_id, 'admin', 0, :now, :now
                )
                """
            ),
            {"id": entry_id, "owner_id": owner_user_id, "now": now},
        )
        connection.execute(
            text(
                """
                INSERT INTO taxonomy_assignments (
                    id, taxonomy_id, term_id, subject_type, subject_id,
                    position, created_at, updated_at
                )
                VALUES (
                    :id, :taxonomy_id, :term_id, 'entry', :entry_id,
                    0, :now, :now
                )
                """
            ),
            {
                "id": str(uuid4()),
                "taxonomy_id": str(taxonomy_id),
                "term_id": str(restaurant_term_id),
                "entry_id": entry_id,
                "now": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO tags (owner_user_id, name, created_at)
                VALUES (:owner_id, 'needs_review', :now)
                """
            ),
            {"owner_id": owner_user_id, "now": now},
        )

    dry_run = apply_classifications(engine, classifications, apply=False)
    assert dry_run == {
        "applied": False,
        "signature_count": 1,
        "entry_count": 1,
        "confidence_counts": {"low": 1},
        "target_entry_counts": {"food_drink/delivery_takeout": 1},
    }

    applied = apply_classifications(engine, classifications, apply=True)
    assert applied["applied"] is True

    with engine.begin() as connection:
        category_path, lifecycle = connection.execute(
            text(
                """
                SELECT parent.name || '/' || term.name, entry.lifecycle
                FROM taxonomy_assignments AS assignment
                JOIN taxonomy_terms AS term ON term.id = assignment.term_id
                JOIN taxonomy_terms AS parent ON parent.id = term.parent_term_id
                JOIN entries AS entry ON entry.id = assignment.subject_id
                WHERE assignment.subject_type = 'entry'
                  AND assignment.subject_id = :entry_id
                  AND assignment.taxonomy_id = :taxonomy_id
                """
            ),
            {"entry_id": entry_id, "taxonomy_id": str(taxonomy_id)},
        ).one()
        review_tag_count = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM entry_tags AS entry_tag
                JOIN tags AS tag ON tag.id = entry_tag.tag_id
                WHERE entry_tag.entry_id = :entry_id AND tag.name = 'needs_review'
                """
            ),
            {"entry_id": entry_id},
        ).scalar_one()

    assert category_path == "food_drink/delivery_takeout"
    assert lifecycle == "DAY_TO_DAY"
    assert review_tag_count == 1
