from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import bindparam, create_engine, inspect, text
from sqlalchemy.orm import Session

from backend.enums_agent import AgentRunStatus, AgentTranscriptRole
from backend.models_agent import AgentRun

REPO_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI_PATH = REPO_ROOT / "alembic.ini"
ALEMBIC_SCRIPT_PATH = REPO_ROOT / "alembic"


def _build_alembic_config(database_url: str) -> Config:
    cfg = Config(str(ALEMBIC_INI_PATH))
    cfg.set_main_option("sqlalchemy.url", database_url)
    cfg.set_main_option("script_location", str(ALEMBIC_SCRIPT_PATH))
    return cfg


def _sqlite_url(tmp_path: Path, name: str) -> str:
    return f"sqlite:///{tmp_path / name}"


def test_migration_0006_creates_agent_append_only_tables(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0006.sqlite")
    command.upgrade(_build_alembic_config(database_url), "0006_agent_append_only_core")

    engine = create_engine(database_url, future=True)
    inspector = inspect(engine)
    assert {
        "agent_threads",
        "agent_messages",
        "agent_message_attachments",
        "agent_runs",
        "agent_tool_calls",
        "agent_change_items",
        "agent_review_actions",
    }.issubset(set(inspector.get_table_names()))

    run_indexes = {row["name"] for row in inspector.get_indexes("agent_runs")}
    assert {"ix_agent_runs_thread_id", "ix_agent_runs_status"}.issubset(run_indexes)


def test_migration_0007_backfills_entity_category_assignments(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0007.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0006_agent_append_only_core")

    now = datetime.now(timezone.utc)
    first_entity_id = str(uuid4())
    second_entity_id = str(uuid4())
    engine = create_engine(database_url, future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO entities (id, name, category, created_at, updated_at)
                VALUES (:id, :name, :category, :created_at, :updated_at)
                """
            ),
            {
                "id": first_entity_id,
                "name": "Groceries Vendor A",
                "category": " Daily  Expense ",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entities (id, name, category, created_at, updated_at)
                VALUES (:id, :name, :category, :created_at, :updated_at)
                """
            ),
            {
                "id": second_entity_id,
                "name": "Groceries Vendor B",
                "category": "daily expense",
                "created_at": now,
                "updated_at": now,
            },
        )

    command.upgrade(cfg, "0007_taxonomy_core")
    with engine.begin() as connection:
        taxonomy_id = connection.execute(
            text("SELECT id FROM taxonomies WHERE key = 'entity_category' LIMIT 1")
        ).scalar_one()
        normalized_term_names = connection.execute(
            text(
                """
                SELECT normalized_name
                FROM taxonomy_terms
                WHERE taxonomy_id = :taxonomy_id
                """
            ),
            {"taxonomy_id": taxonomy_id},
        ).scalars()
        assignments = connection.execute(
            text(
                """
                SELECT subject_id
                FROM taxonomy_assignments
                WHERE taxonomy_id = :taxonomy_id
                """
            ),
            {"taxonomy_id": taxonomy_id},
        ).scalars()

        assert list(normalized_term_names) == ["daily expense"]
        assert set(assignments) == {first_entity_id, second_entity_id}


def test_migration_0025_converts_user_memory_text_to_json_list(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0025.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0024_entity_root_accounts")

    engine = create_engine(database_url, future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO runtime_settings (scope, current_user_name, user_memory, created_at, updated_at)
                VALUES (:scope, :current_user_name, :user_memory, :created_at, :updated_at)
                """
            ),
            {
                "scope": "default",
                "current_user_name": "admin",
                "user_memory": "Prefers terse answers.\n- Works in CAD.",
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            },
        )

    command.upgrade(cfg, "0025_user_memory_json_list")

    with engine.begin() as connection:
        stored_value = connection.execute(
            text("SELECT user_memory FROM runtime_settings WHERE scope = 'default' LIMIT 1")
        ).scalar_one()
    assert json.loads(stored_value) == ["Prefers terse answers.", "Works in CAD."]


def test_migration_0026_converts_legacy_links_to_typed_groups(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0026.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0025_user_memory_json_list")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    split_group_id = str(uuid4())
    fallback_group_id = str(uuid4())
    singleton_group_id = str(uuid4())
    split_parent_id = str(uuid4())
    split_child_id = str(uuid4())
    split_child_two_id = str(uuid4())
    invalid_first_id = str(uuid4())
    invalid_second_id = str(uuid4())
    singleton_entry_id = str(uuid4())

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO entry_groups (id, created_at, updated_at)
                VALUES
                  (:split_group_id, :created_at, :updated_at),
                  (:fallback_group_id, :created_at, :updated_at),
                  (:singleton_group_id, :created_at, :updated_at)
                """
            ),
            {
                "split_group_id": split_group_id,
                "fallback_group_id": fallback_group_id,
                "singleton_group_id": singleton_group_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entries
                  (
                    id,
                    group_id,
                    account_id,
                    kind,
                    occurred_at,
                    name,
                    amount_minor,
                    currency_code,
                    from_entity_id,
                    to_entity_id,
                    owner_user_id,
                    from_entity,
                    to_entity,
                    owner,
                    markdown_body,
                    is_deleted,
                    deleted_at,
                    created_at,
                    updated_at
                  )
                VALUES
                  (:split_parent_id, :split_group_id, NULL, 'EXPENSE', '2026-03-01', 'Dinner', 2400, 'USD', NULL, NULL, NULL, NULL, NULL, 'admin', NULL, 0, NULL, :created_at, :updated_at),
                  (:split_child_id, :split_group_id, NULL, 'INCOME', '2026-03-02', 'Alice', 1200, 'USD', NULL, NULL, NULL, NULL, NULL, 'admin', NULL, 0, NULL, :created_at, :updated_at),
                  (:split_child_two_id, :split_group_id, NULL, 'INCOME', '2026-03-03', 'Bob', 1200, 'USD', NULL, NULL, NULL, NULL, NULL, 'admin', NULL, 0, NULL, :created_at, :updated_at),
                  (:invalid_first_id, :fallback_group_id, NULL, 'EXPENSE', '2026-03-04', 'Bad parent', 1000, 'USD', NULL, NULL, NULL, NULL, NULL, 'admin', NULL, 0, NULL, :created_at, :updated_at),
                  (:invalid_second_id, :fallback_group_id, NULL, 'EXPENSE', '2026-03-05', 'Bad child', 1000, 'USD', NULL, NULL, NULL, NULL, NULL, 'admin', NULL, 0, NULL, :created_at, :updated_at),
                  (:singleton_entry_id, :singleton_group_id, NULL, 'EXPENSE', '2026-03-06', 'Singleton', 500, 'USD', NULL, NULL, NULL, NULL, NULL, 'admin', NULL, 0, NULL, :created_at, :updated_at)
                """
            ),
            {
                "split_parent_id": split_parent_id,
                "split_child_id": split_child_id,
                "split_child_two_id": split_child_two_id,
                "invalid_first_id": invalid_first_id,
                "invalid_second_id": invalid_second_id,
                "singleton_entry_id": singleton_entry_id,
                "split_group_id": split_group_id,
                "fallback_group_id": fallback_group_id,
                "singleton_group_id": singleton_group_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entry_links (id, source_entry_id, target_entry_id, link_type, note, created_at)
                VALUES
                  (:split_link_one, :split_parent_id, :split_child_id, 'SPLIT', NULL, :created_at),
                  (:split_link_two, :split_parent_id, :split_child_two_id, 'SPLIT', NULL, :created_at),
                  (:invalid_link, :invalid_first_id, :invalid_second_id, 'SPLIT', NULL, :created_at)
                """
            ),
            {
                "split_link_one": str(uuid4()),
                "split_link_two": str(uuid4()),
                "invalid_link": str(uuid4()),
                "split_parent_id": split_parent_id,
                "split_child_id": split_child_id,
                "split_child_two_id": split_child_two_id,
                "invalid_first_id": invalid_first_id,
                "invalid_second_id": invalid_second_id,
                "created_at": now,
            },
        )

    previous_backfill_user = os.environ.get("BILL_HELPER_OWNER_BACKFILL_USER_NAME")
    os.environ["BILL_HELPER_OWNER_BACKFILL_USER_NAME"] = "admin"
    try:
        command.upgrade(cfg, "head")
    finally:
        if previous_backfill_user is None:
            os.environ.pop("BILL_HELPER_OWNER_BACKFILL_USER_NAME", None)
        else:
            os.environ["BILL_HELPER_OWNER_BACKFILL_USER_NAME"] = previous_backfill_user

    inspector = inspect(engine)
    assert "entry_group_members" in inspector.get_table_names()
    assert "entry_links" not in inspector.get_table_names()
    entry_columns = {column["name"] for column in inspector.get_columns("entries")}
    assert "group_id" not in entry_columns

    with engine.begin() as connection:
        groups = {
            str(row[0]): str(row[1])
            for row in connection.execute(
                text("SELECT id, group_type FROM entry_groups ORDER BY id ASC")
            ).all()
        }
        assert groups[split_group_id] == "SPLIT"
        assert groups[fallback_group_id] == "BUNDLE"
        assert singleton_group_id not in groups

        roles = {
            str(row[0]): row[1]
            for row in connection.execute(
                text(
                    """
                    SELECT entry_id, member_role
                    FROM entry_group_members
                    WHERE group_id = :group_id
                    ORDER BY position ASC
                    """
                ),
                {"group_id": split_group_id},
            ).all()
        }
        assert roles[split_parent_id] == "PARENT"
        assert roles[split_child_id] == "CHILD"
        assert roles[split_child_two_id] == "CHILD"


def test_migration_0035_creates_user_files_and_backfills_agent_attachments(tmp_path, monkeypatch):
    from backend.config import get_settings

    database_url = _sqlite_url(tmp_path, "migration_0035.sqlite")
    cfg = _build_alembic_config(database_url)
    data_dir = tmp_path / "data"
    monkeypatch.setenv("BILL_HELPER_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    command.upgrade(cfg, "0034_add_entry_tagging_model_to_runtime_settings")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    thread_id = str(uuid4())
    message_id = str(uuid4())
    attachment_id = str(uuid4())
    legacy_upload_dir = data_dir / "agent_uploads" / message_id
    legacy_upload_dir.mkdir(parents=True, exist_ok=True)
    legacy_upload_path = legacy_upload_dir / "receipt.png"
    legacy_upload_path.write_bytes(b"\x89PNG\r\n\x1a\n")

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO users (id, name, password_hash, is_admin, created_at, updated_at)
                VALUES (:id, :name, :password_hash, :is_admin, :created_at, :updated_at)
                """
            ),
            {
                "id": user_id,
                "name": "migration-user",
                "password_hash": "hash",
                "is_admin": 0,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_threads (id, owner_user_id, title, created_at, updated_at)
                VALUES (:id, :owner_user_id, NULL, :created_at, :updated_at)
                """
            ),
            {
                "id": thread_id,
                "owner_user_id": user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_messages (id, thread_id, role, content_markdown, created_at)
                VALUES (:id, :thread_id, 'user', 'hello', :created_at)
                """
            ),
            {
                "id": message_id,
                "thread_id": thread_id,
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_message_attachments
                  (id, message_id, mime_type, original_filename, file_path, created_at)
                VALUES
                  (:id, :message_id, :mime_type, :original_filename, :file_path, :created_at)
                """
            ),
            {
                "id": attachment_id,
                "message_id": message_id,
                "mime_type": "image/png",
                "original_filename": "receipt.png",
                "file_path": str(legacy_upload_path),
                "created_at": now,
            },
        )

    command.upgrade(cfg, "0035_add_user_files_and_agent_workspace")

    migrated_path = data_dir / "user_files" / user_id / "uploads" / f"{attachment_id}.png"
    with engine.begin() as connection:
        user_file_row = connection.execute(
            text(
                """
                SELECT owner_user_id, storage_area, source_type, stored_relative_path, mime_type
                FROM user_files
                """
            )
        ).mappings().one()
        attachment_row = connection.execute(
            text(
                """
                SELECT user_file_id
                FROM agent_message_attachments
                WHERE id = :attachment_id
                """
            ),
            {"attachment_id": attachment_id},
        ).mappings().one()

    assert user_file_row["owner_user_id"] == user_id
    assert user_file_row["storage_area"] == "upload"
    assert user_file_row["source_type"] == "agent_message_attachment"
    assert user_file_row["stored_relative_path"] == f"uploads/{attachment_id}.png"
    assert user_file_row["mime_type"] == "image/png"
    assert attachment_row["user_file_id"]
    assert migrated_path.exists()
    assert not legacy_upload_path.exists()

    get_settings.cache_clear()


def test_migration_0031_adds_users_is_admin_column(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0031.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0030_add_account_agent_change_types")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO users (id, name, created_at, updated_at)
                VALUES (:id, :name, :created_at, :updated_at)
                """
            ),
            {
                "id": user_id,
                "name": "alice",
                "created_at": now,
                "updated_at": now,
            },
        )

    previous_backfill_user = os.environ.get("BILL_HELPER_OWNER_BACKFILL_USER_NAME")
    os.environ["BILL_HELPER_OWNER_BACKFILL_USER_NAME"] = "alice"
    try:
        command.upgrade(cfg, "head")
    finally:
        if previous_backfill_user is None:
            os.environ.pop("BILL_HELPER_OWNER_BACKFILL_USER_NAME", None)
        else:
            os.environ["BILL_HELPER_OWNER_BACKFILL_USER_NAME"] = previous_backfill_user

    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    assert "is_admin" in user_columns

    with engine.begin() as connection:
        stored_is_admin = connection.execute(
            text("SELECT is_admin FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        ).scalar_one()
    assert int(stored_is_admin) == 0


def test_migration_0017_renames_old_tag_taxonomy_when_new_key_missing(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0017.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0016_add_user_memory_to_runtime_settings")

    now = datetime.now(timezone.utc)
    old_taxonomy_id = str(uuid4())
    old_term_id = str(uuid4())
    old_assignment_id = str(uuid4())
    subject_id = str(uuid4())
    engine = create_engine(database_url, future=True)
    with engine.begin() as connection:
        existing_new_taxonomy_id = connection.execute(
            text("SELECT id FROM taxonomies WHERE key = :key LIMIT 1"),
            {"key": "tag_type"},
        ).scalar_one_or_none()
        if existing_new_taxonomy_id is not None:
            connection.execute(
                text("DELETE FROM taxonomy_assignments WHERE taxonomy_id = :taxonomy_id"),
                {"taxonomy_id": existing_new_taxonomy_id},
            )
            connection.execute(
                text("DELETE FROM taxonomy_terms WHERE taxonomy_id = :taxonomy_id"),
                {"taxonomy_id": existing_new_taxonomy_id},
            )
            connection.execute(
                text("DELETE FROM taxonomies WHERE id = :taxonomy_id"),
                {"taxonomy_id": existing_new_taxonomy_id},
            )

        connection.execute(
            text(
                """
                INSERT INTO taxonomies (id, key, applies_to, cardinality, display_name, created_at, updated_at)
                VALUES (:id, :key, :applies_to, :cardinality, :display_name, :created_at, :updated_at)
                """
            ),
            {
                "id": old_taxonomy_id,
                "key": "tag_category",
                "applies_to": "tag",
                "cardinality": "single",
                "display_name": "Tag Categories",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO taxonomy_terms
                  (id, taxonomy_id, name, normalized_name, parent_term_id, metadata_json, created_at, updated_at)
                VALUES
                  (:id, :taxonomy_id, :name, :normalized_name, NULL, NULL, :created_at, :updated_at)
                """
            ),
            {
                "id": old_term_id,
                "taxonomy_id": old_taxonomy_id,
                "name": "Utilities",
                "normalized_name": "utilities",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO taxonomy_assignments
                  (id, taxonomy_id, term_id, subject_type, subject_id, position, created_at, updated_at)
                VALUES
                  (:id, :taxonomy_id, :term_id, :subject_type, :subject_id, 0, :created_at, :updated_at)
                """
            ),
            {
                "id": old_assignment_id,
                "taxonomy_id": old_taxonomy_id,
                "term_id": old_term_id,
                "subject_type": "tag",
                "subject_id": subject_id,
                "created_at": now,
                "updated_at": now,
            },
        )

    command.upgrade(cfg, "0017_rename_tag_category_taxonomy")
    with engine.begin() as connection:
        old_key_id = connection.execute(
            text("SELECT id FROM taxonomies WHERE key = :key LIMIT 1"),
            {"key": "tag_category"},
        ).scalar_one_or_none()
        new_taxonomy_row = connection.execute(
            text(
                """
                SELECT id, display_name
                FROM taxonomies
                WHERE key = :key
                LIMIT 1
                """
            ),
            {"key": "tag_type"},
        ).first()
        term_count = connection.execute(
            text("SELECT COUNT(*) FROM taxonomy_terms WHERE taxonomy_id = :taxonomy_id"),
            {"taxonomy_id": old_taxonomy_id},
        ).scalar_one()
        assignment_count = connection.execute(
            text("SELECT COUNT(*) FROM taxonomy_assignments WHERE taxonomy_id = :taxonomy_id"),
            {"taxonomy_id": old_taxonomy_id},
        ).scalar_one()

        assert old_key_id is None
        assert new_taxonomy_row is not None
        assert str(new_taxonomy_row[0]) == old_taxonomy_id
        assert str(new_taxonomy_row[1]) == "Tag Types"
        assert int(term_count) == 1
        assert int(assignment_count) == 1


def test_migration_chain_reaches_head_from_empty_database(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_head.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "head")

    engine = create_engine(database_url, future=True)
    with engine.begin() as connection:
        version_num = connection.execute(
            text("SELECT version_num FROM alembic_version LIMIT 1")
        ).scalar_one_or_none()
        assert isinstance(version_num, str)
        assert version_num


def test_migration_0046_backfills_category_and_lifecycle_from_tags(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0046.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0045_agent_harness_first_schema")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    grocery_entry_id = str(uuid4())
    one_time_entry_id = str(uuid4())
    with engine.begin() as connection:
        owner_user_id = connection.execute(
            text("SELECT id FROM users WHERE name = 'admin' LIMIT 1")
        ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO entries (
                    id, kind, occurred_at, name, amount_minor, currency_code,
                    owner_user_id, owner, is_deleted, created_at, updated_at
                )
                VALUES
                    (:grocery_id, 'EXPENSE', '2026-01-02', 'Groceries', 1200, 'CAD',
                     :owner_id, 'admin', 0, :now, :now),
                    (:one_time_id, 'EXPENSE', '2026-01-03', 'Appliance', 5000, 'CAD',
                     :owner_id, 'admin', 0, :now, :now)
                """
            ),
            {
                "grocery_id": grocery_entry_id,
                "one_time_id": one_time_entry_id,
                "owner_id": owner_user_id,
                "now": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO tags (owner_user_id, name, created_at)
                VALUES
                    (:owner_id, 'grocery', :now),
                    (:owner_id, 'electronics', :now),
                    (:owner_id, 'one_time', :now)
                """
            ),
            {"owner_id": owner_user_id, "now": now},
        )
        tag_ids = {
            str(name): int(tag_id)
            for tag_id, name in connection.execute(
                text("SELECT id, name FROM tags WHERE name IN ('grocery', 'electronics', 'one_time')")
            ).all()
        }
        connection.execute(
            text(
                """
                INSERT INTO entry_tags (entry_id, tag_id)
                VALUES
                    (:grocery_id, :grocery_tag_id),
                    (:one_time_id, :electronics_tag_id),
                    (:one_time_id, :one_time_tag_id)
                """
            ),
            {
                "grocery_id": grocery_entry_id,
                "one_time_id": one_time_entry_id,
                "grocery_tag_id": tag_ids["grocery"],
                "electronics_tag_id": tag_ids["electronics"],
                "one_time_tag_id": tag_ids["one_time"],
            },
        )

    command.upgrade(cfg, "0046_entry_category_lifecycle")

    with engine.begin() as connection:
        lifecycle_by_entry = {
            str(entry_id): lifecycle
            for entry_id, lifecycle in connection.execute(
                text("SELECT id, lifecycle FROM entries WHERE id IN (:grocery_id, :one_time_id)"),
                {"grocery_id": grocery_entry_id, "one_time_id": one_time_entry_id},
            ).all()
        }
        category_by_entry = {
            str(subject_id): f"{parent_name}/{term_name}" if parent_name else str(term_name)
            for subject_id, term_name, parent_name in connection.execute(
                text(
                    """
                    SELECT assignment.subject_id, term.name, parent.name
                    FROM taxonomy_assignments AS assignment
                    JOIN taxonomies AS taxonomy ON taxonomy.id = assignment.taxonomy_id
                    JOIN taxonomy_terms AS term ON term.id = assignment.term_id
                    LEFT JOIN taxonomy_terms AS parent ON parent.id = term.parent_term_id
                    WHERE taxonomy.key = 'entry_category'
                    """
                )
            ).all()
        }
        remaining_migrated_tags = connection.execute(
            text("SELECT name FROM tags WHERE name IN ('grocery', 'electronics', 'one_time')")
        ).scalars().all()

    assert lifecycle_by_entry[grocery_entry_id] == "DAY_TO_DAY"
    assert lifecycle_by_entry[one_time_entry_id] == "ONE_TIME"
    assert category_by_entry[grocery_entry_id] == "food_drink/grocery"
    assert category_by_entry[one_time_entry_id] == "shopping_lifestyle/electronics"
    assert remaining_migrated_tags == []


def test_migration_0047_replaces_entry_category_schedule(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0047.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0046_entry_category_lifecycle")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    source_categories = [
        "internet_mobile",
        "subscriptions",
        "debt_payment",
        "fitness",
        "transportation",
    ]
    entry_ids = {name: str(uuid4()) for name in source_categories}
    with engine.begin() as connection:
        owner_user_id = str(
            connection.execute(
                text("SELECT id FROM users WHERE name = 'admin' LIMIT 1")
            ).scalar_one()
        )
        taxonomy_id = str(
            connection.execute(
                text(
                    """
                    SELECT id FROM taxonomies
                    WHERE owner_user_id = :owner_id AND key = 'entry_category'
                    """
                ),
                {"owner_id": owner_user_id},
            ).scalar_one()
        )
        term_ids = {
            str(name): str(term_id)
            for term_id, name in connection.execute(
                text(
                    """
                    SELECT id, name FROM taxonomy_terms
                    WHERE taxonomy_id = :taxonomy_id AND name IN :names
                    """
                ).bindparams(bindparam("names", expanding=True)),
                {"taxonomy_id": taxonomy_id, "names": source_categories},
            ).all()
        }
        for category_name, entry_id in entry_ids.items():
            connection.execute(
                text(
                    """
                    INSERT INTO entries (
                        id, kind, occurred_at, name, amount_minor, currency_code,
                        owner_user_id, owner, is_deleted, created_at, updated_at
                    )
                    VALUES (
                        :id, 'EXPENSE', '2026-06-01', :name, 1000, 'CAD',
                        :owner_id, 'admin', 0, :now, :now
                    )
                    """
                ),
                {
                    "id": entry_id,
                    "name": category_name,
                    "owner_id": owner_user_id,
                    "now": now,
                },
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
                    "taxonomy_id": taxonomy_id,
                    "term_id": term_ids[category_name],
                    "entry_id": entry_id,
                    "now": now,
                },
            )

    command.upgrade(cfg, "0047_entry_category_schedule")

    with engine.begin() as connection:
        category_by_entry = {
            str(subject_id): (
                f"{parent_name}/{term_name}" if parent_name else str(term_name)
            )
            for subject_id, term_name, parent_name in connection.execute(
                text(
                    """
                    SELECT assignment.subject_id, term.name, parent.name
                    FROM taxonomy_assignments AS assignment
                    JOIN taxonomy_terms AS term ON term.id = assignment.term_id
                    LEFT JOIN taxonomy_terms AS parent ON parent.id = term.parent_term_id
                    WHERE assignment.taxonomy_id = :taxonomy_id
                    """
                ),
                {"taxonomy_id": taxonomy_id},
            ).all()
        }
        internet_metadata = connection.execute(
            text(
                """
                SELECT metadata_json FROM taxonomy_terms
                WHERE taxonomy_id = :taxonomy_id AND name = 'internet'
                """
            ),
            {"taxonomy_id": taxonomy_id},
        ).scalar_one()
        if isinstance(internet_metadata, str):
            internet_metadata = json.loads(internet_metadata)
        remaining_legacy_names = connection.execute(
            text(
                """
                SELECT name FROM taxonomy_terms
                WHERE taxonomy_id = :taxonomy_id
                  AND name IN ('internet_mobile', 'subscriptions', 'debt_payment', 'saas')
                """
            ),
            {"taxonomy_id": taxonomy_id},
        ).scalars().all()
        lifecycle_by_entry = {
            str(entry_id): lifecycle
            for entry_id, lifecycle in connection.execute(
                text("SELECT id, lifecycle FROM entries WHERE id IN :entry_ids").bindparams(
                    bindparam("entry_ids", expanding=True)
                ),
                {"entry_ids": list(entry_ids.values())},
            ).all()
        }

    assert category_by_entry[entry_ids["internet_mobile"]] == "housing/internet"
    assert category_by_entry[entry_ids["subscriptions"]] == (
        "software_tools/software_subscriptions"
    )
    assert entry_ids["debt_payment"] not in category_by_entry
    assert category_by_entry[entry_ids["fitness"]] == "health/fitness"
    assert category_by_entry[entry_ids["transportation"]] == "transport/transit"
    assert lifecycle_by_entry[entry_ids["internet_mobile"]] == "FIXED"
    assert lifecycle_by_entry[entry_ids["fitness"]] == "FIXED"
    assert lifecycle_by_entry[entry_ids["transportation"]] == "DAY_TO_DAY"
    assert lifecycle_by_entry[entry_ids["debt_payment"]] is None
    assert internet_metadata["description"] == "Home internet service."
    assert internet_metadata["default_lifecycle"] == "fixed"
    assert remaining_legacy_names == []


def test_migration_0048_removes_builtin_filter_groups_only(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0048.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0047_entry_category_schedule")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    default_id = str(uuid4())
    custom_id = str(uuid4())
    empty_rule = {
        "include": {
            "type": "group",
            "operator": "AND",
            "children": [],
        },
        "exclude": None,
    }
    with engine.begin() as connection:
        owner_user_id = str(
            connection.execute(
                text("SELECT id FROM users WHERE name = 'admin' LIMIT 1")
            ).scalar_one()
        )
        connection.execute(
            text(
                """
                INSERT INTO filter_groups (
                    id, owner_user_id, key, name, description, color,
                    is_default, position, definition_json, created_at, updated_at
                )
                VALUES
                    (:default_id, :owner_id, 'transfers', 'transfers', NULL, NULL,
                     1, 0, :rule, :now, :now),
                    (:custom_id, :owner_id, 'custom_travel', 'travel', NULL, NULL,
                     0, 1, :rule, :now, :now)
                """
            ),
            {
                "default_id": default_id,
                "custom_id": custom_id,
                "owner_id": owner_user_id,
                "rule": json.dumps(empty_rule),
                "now": now,
            },
        )

    command.upgrade(cfg, "0048_remove_builtin_filter_groups")

    with engine.begin() as connection:
        rows = connection.execute(
            text("SELECT id, key, is_default FROM filter_groups ORDER BY position")
        ).all()

    assert rows == [(custom_id, "custom_travel", 0)]


def test_migration_0024_rewrites_account_ids_to_entity_roots(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0024.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0023_add_agent_provider_config")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    old_account_id = str(uuid4())
    account_entity_id = str(uuid4())
    group_id = str(uuid4())
    entry_id = str(uuid4())
    snapshot_id = str(uuid4())
    term_id = str(uuid4())
    assignment_id = str(uuid4())

    with engine.begin() as connection:
        taxonomy_id = connection.execute(
            text("SELECT id FROM taxonomies WHERE key = 'entity_category' LIMIT 1")
        ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO entities (id, name, category, created_at, updated_at)
                VALUES (:id, :name, :category, :created_at, :updated_at)
                """
            ),
            {
                "id": account_entity_id,
                "name": "Primary Checking",
                "category": "cash account",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO taxonomy_terms
                  (id, taxonomy_id, name, normalized_name, parent_term_id, metadata_json, created_at, updated_at)
                VALUES
                  (:id, :taxonomy_id, :name, :normalized_name, NULL, NULL, :created_at, :updated_at)
                """
            ),
            {
                "id": term_id,
                "taxonomy_id": taxonomy_id,
                "name": "cash account",
                "normalized_name": "cash account",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO taxonomy_assignments
                  (id, taxonomy_id, term_id, subject_type, subject_id, position, created_at, updated_at)
                VALUES
                  (:id, :taxonomy_id, :term_id, 'entity', :subject_id, 0, :created_at, :updated_at)
                """
            ),
            {
                "id": assignment_id,
                "taxonomy_id": taxonomy_id,
                "term_id": term_id,
                "subject_id": account_entity_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO accounts
                  (id, name, owner_user_id, entity_id, markdown_body, currency_code, is_active, created_at, updated_at)
                VALUES
                  (:id, :name, NULL, :entity_id, :markdown_body, :currency_code, :is_active, :created_at, :updated_at)
                """
            ),
            {
                "id": old_account_id,
                "name": "Primary Checking",
                "entity_id": account_entity_id,
                "markdown_body": "shared root migration",
                "currency_code": "USD",
                "is_active": 1,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entry_groups (id, created_at, updated_at)
                VALUES (:id, :created_at, :updated_at)
                """
            ),
            {
                "id": group_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entries
                  (
                    id,
                    group_id,
                    account_id,
                    kind,
                    occurred_at,
                    name,
                    amount_minor,
                    currency_code,
                    from_entity_id,
                    to_entity_id,
                    owner_user_id,
                    from_entity,
                    to_entity,
                    owner,
                    markdown_body,
                    is_deleted,
                    deleted_at,
                    created_at,
                    updated_at
                  )
                VALUES
                  (
                    :id,
                    :group_id,
                    :account_id,
                    :kind,
                    :occurred_at,
                    :name,
                    :amount_minor,
                    :currency_code,
                    :from_entity_id,
                    NULL,
                    NULL,
                    :from_entity,
                    NULL,
                    'admin',
                    NULL,
                    0,
                    NULL,
                    :created_at,
                    :updated_at
                  )
                """
            ),
            {
                "id": entry_id,
                "group_id": group_id,
                "account_id": old_account_id,
                "kind": "EXPENSE",
                "occurred_at": "2026-03-01",
                "name": "Migrated rent",
                "amount_minor": 125000,
                "currency_code": "USD",
                "from_entity_id": account_entity_id,
                "from_entity": "Primary Checking",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO account_snapshots
                  (id, account_id, snapshot_at, balance_minor, note, created_at)
                VALUES
                  (:id, :account_id, :snapshot_at, :balance_minor, :note, :created_at)
                """
            ),
            {
                "id": snapshot_id,
                "account_id": old_account_id,
                "snapshot_at": "2026-03-01",
                "balance_minor": 125000,
                "note": "pre-migration",
                "created_at": now,
            },
        )

    command.upgrade(cfg, "0024_entity_root_accounts")

    inspector = inspect(engine)
    account_columns = {column["name"] for column in inspector.get_columns("accounts")}
    assert "entity_id" not in account_columns
    assert "name" not in account_columns

    with engine.begin() as connection:
        account_row = connection.execute(
            text("SELECT id, markdown_body, currency_code, is_active FROM accounts LIMIT 1")
        ).mappings().one()
        entry_account_id = connection.execute(
            text("SELECT account_id FROM entries WHERE id = :id"),
            {"id": entry_id},
        ).scalar_one()
        snapshot_account_id = connection.execute(
            text("SELECT account_id FROM account_snapshots WHERE id = :id"),
            {"id": snapshot_id},
        ).scalar_one()
        entity_category = connection.execute(
            text("SELECT category FROM entities WHERE id = :id"),
            {"id": account_entity_id},
        ).scalar_one()
        assignment_count = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM taxonomy_assignments
                WHERE subject_type = 'entity' AND subject_id = :subject_id
                """
            ),
            {"subject_id": account_entity_id},
        ).scalar_one()

        assert str(account_row["id"]) == account_entity_id
        assert str(entry_account_id) == account_entity_id
        assert str(snapshot_account_id) == account_entity_id
        assert str(account_row["markdown_body"]) == "shared root migration"
        assert str(account_row["currency_code"]) == "USD"
        assert int(account_row["is_active"]) == 1
        assert entity_category is None
        assert int(assignment_count) == 0


def test_migration_0028_adds_available_agent_models_column(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0028.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0027_add_agent_bulk_concurrency_setting")

    engine = create_engine(database_url, future=True)
    inspector = inspect(engine)
    assert "available_agent_models" not in {
        column["name"] for column in inspector.get_columns("runtime_settings")
    }

    command.upgrade(cfg, "0028_add_available_agent_models_to_runtime_settings")

    inspector = inspect(engine)
    assert "available_agent_models" in {
        column["name"] for column in inspector.get_columns("runtime_settings")
    }


def test_migration_0030_adds_account_agent_change_types(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0030.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0030_add_account_agent_change_types")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    thread_id = str(uuid4())
    message_id = str(uuid4())
    run_id = str(uuid4())
    change_id = str(uuid4())

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO agent_threads (id, title, created_at, updated_at)
                VALUES (:id, NULL, :created_at, :updated_at)
                """
            ),
            {
                "id": thread_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_messages (id, thread_id, role, content_markdown, created_at)
                VALUES (:id, :thread_id, 'USER', 'Create my account', :created_at)
                """
            ),
            {
                "id": message_id,
                "thread_id": thread_id,
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_runs
                  (id, thread_id, user_message_id, assistant_message_id, status, model_name, created_at, completed_at)
                VALUES
                  (:id, :thread_id, :user_message_id, NULL, 'COMPLETED', 'gpt-test', :created_at, :completed_at)
                """
            ),
            {
                "id": run_id,
                "thread_id": thread_id,
                "user_message_id": message_id,
                "created_at": now,
                "completed_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_change_items
                  (id, run_id, change_type, payload_json, rationale_text, status, review_note, applied_resource_type, applied_resource_id, created_at, updated_at)
                VALUES
                  (:id, :run_id, 'CREATE_ACCOUNT', :payload_json, 'Agent proposed creating an account.', 'PENDING_REVIEW', NULL, NULL, NULL, :created_at, :updated_at)
                """
            ),
            {
                "id": change_id,
                "run_id": run_id,
                "payload_json": json.dumps({"name": "Travel Card", "currency_code": "CAD", "is_active": True}),
                "created_at": now,
                "updated_at": now,
            },
        )

        stored_change_type = connection.execute(
            text("SELECT change_type FROM agent_change_items WHERE id = :id"),
            {"id": change_id},
        ).scalar_one()

    assert stored_change_type == "CREATE_ACCOUNT"


def test_head_migration_includes_agent_run_created_at_index(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_head.sqlite")
    command.upgrade(_build_alembic_config(database_url), "head")

    engine = create_engine(database_url, future=True)
    inspector = inspect(engine)
    run_indexes = {row["name"] for row in inspector.get_indexes("agent_runs")}

    assert "ix_agent_runs_created_at" in run_indexes


def test_head_migration_includes_agent_run_approval_policy(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_head_approval_policy.sqlite")
    command.upgrade(_build_alembic_config(database_url), "head")

    engine = create_engine(database_url, future=True)
    inspector = inspect(engine)
    run_columns = {column["name"] for column in inspector.get_columns("agent_runs")}

    assert "approval_policy" in run_columns


def test_migration_0042_backfills_account_links_and_drops_account_id(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0042.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0041_add_agent_run_event_reasoning_duration_ms")

    engine = create_engine(database_url, future=True)
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    user_name = f"migration-user-{user_id[:8]}"
    account_entity_id = str(uuid4())
    entry_id = str(uuid4())

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO users (id, name, password_hash, is_admin, created_at, updated_at)
                VALUES (:id, :name, :password_hash, 0, :created_at, :updated_at)
                """
            ),
            {
                "id": user_id,
                "name": user_name,
                "password_hash": "test",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entities (id, owner_user_id, name, category, created_at, updated_at)
                VALUES (:id, :owner_user_id, :name, 'account', :created_at, :updated_at)
                """
            ),
            {
                "id": account_entity_id,
                "owner_user_id": user_id,
                "name": "Checking",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO accounts (id, owner_user_id, currency_code, is_active, created_at, updated_at)
                VALUES (:id, :owner_user_id, 'USD', 1, :created_at, :updated_at)
                """
            ),
            {
                "id": account_entity_id,
                "owner_user_id": user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO entries
                  (
                    id, account_id, kind, occurred_at, name, amount_minor, currency_code,
                    from_entity_id, to_entity_id, owner_user_id, from_entity, to_entity, owner,
                    markdown_body, is_deleted, deleted_at, created_at, updated_at
                  )
                VALUES
                  (
                    :id, :account_id, 'EXPENSE', '2026-01-10', 'Coffee', 500, 'USD',
                    NULL, NULL, :owner_user_id, NULL, NULL, :owner, NULL, 0, NULL, :created_at, :updated_at
                  )
                """
            ),
            {
                "id": entry_id,
                "account_id": account_entity_id,
                "owner_user_id": user_id,
                "owner": user_name,
                "created_at": now,
                "updated_at": now,
            },
        )

    command.upgrade(cfg, "head")

    inspector = inspect(engine)
    entry_columns = {column["name"] for column in inspector.get_columns("entries")}
    assert "account_id" not in entry_columns

    with engine.begin() as connection:
        from_entity_id = connection.execute(
            text("SELECT from_entity_id FROM entries WHERE id = :id"),
            {"id": entry_id},
        ).scalar_one()
        assert str(from_entity_id) == account_entity_id


def test_migration_0044_drops_agent_change_item_rationale_text(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0044.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0043_add_import_workflow")

    engine = create_engine(database_url, future=True)
    inspector = inspect(engine)
    assert "rationale_text" in {column["name"] for column in inspector.get_columns("agent_change_items")}

    command.upgrade(cfg, "0044_remove_agent_change_item_rationale_text")

    inspector = inspect(engine)
    assert "rationale_text" not in {column["name"] for column in inspector.get_columns("agent_change_items")}


def test_migration_0045_ports_legacy_agent_transcripts(tmp_path):
    database_url = _sqlite_url(tmp_path, "migration_0045_port.sqlite")
    cfg = _build_alembic_config(database_url)
    command.upgrade(cfg, "0044_remove_agent_change_item_rationale_text")

    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    thread_id = str(uuid4())
    user_message_id = str(uuid4())
    assistant_message_id = str(uuid4())
    run_id = str(uuid4())
    tool_call_id = str(uuid4())

    engine = create_engine(database_url, future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO users (id, name, password_hash, is_admin, created_at, updated_at)
                VALUES (:id, :name, :password_hash, :is_admin, :created_at, :updated_at)
                """
            ),
            {
                "id": user_id,
                "name": "legacy-port-user",
                "password_hash": "hash",
                "is_admin": False,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_threads (id, owner_user_id, title, summary, created_at, updated_at)
                VALUES (:id, :owner_user_id, :title, :summary, :created_at, :updated_at)
                """
            ),
            {
                "id": thread_id,
                "owner_user_id": user_id,
                "title": "Port me",
                "summary": None,
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_messages (id, thread_id, role, content_markdown, created_at)
                VALUES (:id, :thread_id, :role, :content_markdown, :created_at)
                """
            ),
            {
                "id": user_message_id,
                "thread_id": thread_id,
                "role": "USER",
                "content_markdown": "What did I spend last month?",
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_messages (id, thread_id, role, content_markdown, created_at)
                VALUES (:id, :thread_id, :role, :content_markdown, :created_at)
                """
            ),
            {
                "id": assistant_message_id,
                "thread_id": thread_id,
                "role": "ASSISTANT",
                "content_markdown": "You spent $42 on groceries.",
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_runs (
                    id, thread_id, user_message_id, assistant_message_id, status, model_name,
                    approval_policy, surface, created_at, completed_at
                ) VALUES (
                    :id, :thread_id, :user_message_id, :assistant_message_id, :status, :model_name,
                    :approval_policy, :surface, :created_at, :completed_at
                )
                """
            ),
            {
                "id": run_id,
                "thread_id": thread_id,
                "user_message_id": user_message_id,
                "assistant_message_id": assistant_message_id,
                "status": "COMPLETED",
                "model_name": "openai/gpt-4.1-mini",
                "approval_policy": "default",
                "surface": "app",
                "created_at": now,
                "completed_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_tool_calls (
                    id, run_id, tool_name, input_json, output_json, output_text, status, created_at
                ) VALUES (
                    :id, :run_id, :tool_name, :input_json, :output_json, :output_text, :status, :created_at
                )
                """
            ),
            {
                "id": tool_call_id,
                "run_id": run_id,
                "tool_name": "run_bh",
                "input_json": json.dumps({"query": "spend last month"}),
                "output_json": json.dumps({"status": "ok"}),
                "output_text": "total=42",
                "status": "OK",
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_run_events (
                    id, run_id, sequence_index, event_type, source, message, tool_call_id, created_at
                ) VALUES (
                    :id, :run_id, :sequence_index, :event_type, :source, :message, :tool_call_id, :created_at
                )
                """
            ),
            {
                "id": str(uuid4()),
                "run_id": run_id,
                "sequence_index": 1,
                "event_type": "REASONING_UPDATE",
                "source": "MODEL_REASONING",
                "message": "Checking spend.",
                "tool_call_id": None,
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_run_events (
                    id, run_id, sequence_index, event_type, source, message, tool_call_id, created_at
                ) VALUES (
                    :id, :run_id, :sequence_index, :event_type, :source, :message, :tool_call_id, :created_at
                )
                """
            ),
            {
                "id": str(uuid4()),
                "run_id": run_id,
                "sequence_index": 2,
                "event_type": "TOOL_CALL_QUEUED",
                "source": "TOOL_CALL",
                "message": None,
                "tool_call_id": tool_call_id,
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO agent_run_events (
                    id, run_id, sequence_index, event_type, source, message, tool_call_id, created_at
                ) VALUES (
                    :id, :run_id, :sequence_index, :event_type, :source, :message, :tool_call_id, :created_at
                )
                """
            ),
            {
                "id": str(uuid4()),
                "run_id": run_id,
                "sequence_index": 3,
                "event_type": "TOOL_CALL_COMPLETED",
                "source": "TOOL_CALL",
                "message": None,
                "tool_call_id": tool_call_id,
                "created_at": now,
            },
        )

    command.upgrade(cfg, "head")

    with engine.begin() as connection:
        thread_title = connection.execute(
            text("SELECT title FROM agent_threads WHERE id = :id"),
            {"id": thread_id},
        ).scalar_one()
        assert thread_title == "Port me"
        assert "agent_messages" not in inspect(connection).get_table_names()
        transcript_roles = connection.execute(
            text(
                """
                SELECT role FROM agent_transcript_messages
                WHERE run_id = :run_id
                ORDER BY sequence_index ASC
                """
            ),
            {"run_id": run_id},
        ).scalars()
        assert list(transcript_roles) == ["USER", "ASSISTANT", "TOOL", "ASSISTANT"]
        turn_index = connection.execute(
            text("SELECT turn_index FROM agent_runs WHERE id = :id"),
            {"id": run_id},
        ).scalar_one()
        assert turn_index == 0
        principal_user_id, metadata_json = connection.execute(
            text(
                "SELECT principal_user_id, metadata_json FROM agent_runs WHERE id = :id"
            ),
            {"id": run_id},
        ).one()
        assert principal_user_id == user_id
        assert json.loads(metadata_json) == {}
        assert connection.execute(text("SELECT COUNT(*) FROM agent_steps")).scalar_one() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM agent_tool_calls")).scalar_one() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM agent_run_events")).scalar_one() == 3

    with Session(engine) as session:
        migrated_run = session.get(AgentRun, run_id)
        assert migrated_run is not None
        assert migrated_run.status is AgentRunStatus.COMPLETED
        assert [message.role for message in migrated_run.transcript_messages] == [
            AgentTranscriptRole.USER,
            AgentTranscriptRole.ASSISTANT,
            AgentTranscriptRole.TOOL,
            AgentTranscriptRole.ASSISTANT,
        ]
        assert len(migrated_run.steps) == 1
        assert len(migrated_run.tool_calls) == 1
        assert len(migrated_run.events) == 3
