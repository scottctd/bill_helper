# CALLING SPEC:
# - Purpose: validate and apply an audited entry-category classification backfill.
# - Inputs: a signature input JSON file, a classification output JSON file, and a database URL.
# - Outputs: a JSON validation/apply summary on stdout.
# - Side effects: with `--apply`, replaces entry-category assignments in one transaction.
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, Engine, bindparam, text

from backend.config import get_settings
from backend.database import build_engine_for_url


REQUIRED_REVISION = "0050_add_agent_model_reasoning_efforts"
VALID_CONFIDENCES = {"high", "medium", "low"}


@dataclass(frozen=True)
class Classification:
    signature_id: str
    target_path: str
    confidence: str
    rationale: str
    entry_ids: tuple[str, ...]


@dataclass(frozen=True)
class EntryState:
    owner_user_id: str
    lifecycle: str | None
    category_default_lifecycle: str | None


def _load_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def load_classifications(
    input_path: Path,
    classifications_path: Path,
) -> list[Classification]:
    source = _load_json_object(input_path)
    result = _load_json_object(classifications_path)
    signatures = source.get("signatures")
    rows = result.get("classifications")
    if not isinstance(signatures, list) or not isinstance(rows, list):
        raise ValueError("input signatures and output classifications must be JSON arrays")

    signatures_by_id: dict[str, dict[str, Any]] = {}
    seen_entry_ids: set[str] = set()
    for raw_signature in signatures:
        if not isinstance(raw_signature, dict):
            raise ValueError("every input signature must be a JSON object")
        signature_id = str(raw_signature.get("signature_id", "")).strip()
        if not signature_id or signature_id in signatures_by_id:
            raise ValueError(f"invalid or duplicate input signature id: {signature_id!r}")
        entry_ids = raw_signature.get("entry_ids")
        allowed_targets = raw_signature.get("allowed_targets")
        if not isinstance(entry_ids, list) or not entry_ids:
            raise ValueError(f"{signature_id} must contain at least one entry id")
        if not isinstance(allowed_targets, list) or not allowed_targets:
            raise ValueError(f"{signature_id} must contain allowed targets")
        normalized_entry_ids = [str(entry_id).strip() for entry_id in entry_ids]
        duplicates = seen_entry_ids.intersection(normalized_entry_ids)
        if duplicates:
            raise ValueError(f"entry ids occur in multiple signatures: {sorted(duplicates)}")
        seen_entry_ids.update(normalized_entry_ids)
        signatures_by_id[signature_id] = raw_signature

    rows_by_id: dict[str, dict[str, Any]] = {}
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            raise ValueError("every classification must be a JSON object")
        signature_id = str(raw_row.get("signature_id", "")).strip()
        if not signature_id or signature_id in rows_by_id:
            raise ValueError(f"invalid or duplicate classification id: {signature_id!r}")
        rows_by_id[signature_id] = raw_row

    missing = sorted(set(signatures_by_id) - set(rows_by_id))
    extra = sorted(set(rows_by_id) - set(signatures_by_id))
    if missing or extra:
        raise ValueError(f"classification ids do not match input: missing={missing}, extra={extra}")

    classifications: list[Classification] = []
    for signature_id, raw_signature in signatures_by_id.items():
        raw_row = rows_by_id[signature_id]
        target_path = str(raw_row.get("target_path", "")).strip()
        confidence = str(raw_row.get("confidence", "")).strip().lower()
        rationale = str(raw_row.get("rationale", "")).strip()
        allowed_targets = {str(value).strip() for value in raw_signature["allowed_targets"]}
        if target_path not in allowed_targets:
            raise ValueError(
                f"{signature_id} target {target_path!r} is not in {sorted(allowed_targets)}"
            )
        if confidence not in VALID_CONFIDENCES:
            raise ValueError(f"{signature_id} has invalid confidence {confidence!r}")
        if not rationale:
            raise ValueError(f"{signature_id} must include a rationale")
        classifications.append(
            Classification(
                signature_id=signature_id,
                target_path=target_path,
                confidence=confidence,
                rationale=rationale,
                entry_ids=tuple(str(entry_id).strip() for entry_id in raw_signature["entry_ids"]),
            )
        )
    return classifications


def _assert_database_revision(connection: Connection) -> None:
    revision = connection.execute(
        text("SELECT version_num FROM alembic_version LIMIT 1")
    ).scalar_one_or_none()
    if revision != REQUIRED_REVISION:
        raise RuntimeError(
            f"database revision must be {REQUIRED_REVISION}, found {revision!r}"
        )


def _metadata_default_lifecycle(value: object) -> str | None:
    if value is None:
        return None
    metadata = json.loads(value) if isinstance(value, str) else value
    if not isinstance(metadata, dict):
        return None
    lifecycle = metadata.get("default_lifecycle")
    return str(lifecycle).upper() if lifecycle is not None else None


def _load_entry_states(
    connection: Connection,
    entry_ids: list[str],
) -> dict[str, EntryState]:
    rows = connection.execute(
        text(
            """
            SELECT entry.id, entry.owner_user_id, entry.lifecycle, term.metadata_json
            FROM entries AS entry
            LEFT JOIN taxonomies AS taxonomy
              ON taxonomy.owner_user_id = entry.owner_user_id
             AND taxonomy.key = 'entry_category'
            LEFT JOIN taxonomy_assignments AS assignment
              ON assignment.taxonomy_id = taxonomy.id
             AND assignment.subject_type = 'entry'
             AND assignment.subject_id = entry.id
            LEFT JOIN taxonomy_terms AS term ON term.id = assignment.term_id
            WHERE entry.is_deleted = 0 AND entry.id IN :entry_ids
            """
        ).bindparams(bindparam("entry_ids", expanding=True)),
        {"entry_ids": entry_ids},
    ).all()
    states = {
        str(entry_id): EntryState(
            owner_user_id=str(owner_user_id),
            lifecycle=str(lifecycle) if lifecycle is not None else None,
            category_default_lifecycle=_metadata_default_lifecycle(metadata_json),
        )
        for entry_id, owner_user_id, lifecycle, metadata_json in rows
    }
    missing = sorted(set(entry_ids) - set(states))
    if missing:
        raise RuntimeError(f"classification input contains missing or deleted entries: {missing}")
    return states


def _load_target_terms(
    connection: Connection,
    owners: set[str],
    target_paths: set[str],
) -> dict[tuple[str, str], tuple[str, str, str]]:
    rows = connection.execute(
        text(
            """
            SELECT taxonomy.owner_user_id, taxonomy.id, term.id, term.name,
                   parent.name, term.metadata_json
            FROM taxonomies AS taxonomy
            JOIN taxonomy_terms AS term ON term.taxonomy_id = taxonomy.id
            LEFT JOIN taxonomy_terms AS parent ON parent.id = term.parent_term_id
            WHERE taxonomy.key = 'entry_category'
              AND taxonomy.owner_user_id IN :owner_ids
            """
        ).bindparams(bindparam("owner_ids", expanding=True)),
        {"owner_ids": sorted(owners)},
    ).all()
    terms: dict[tuple[str, str], tuple[str, str, str]] = {}
    for owner_user_id, taxonomy_id, term_id, term_name, parent_name, metadata_json in rows:
        path = f"{parent_name}/{term_name}" if parent_name else str(term_name)
        if path in target_paths:
            default_lifecycle = _metadata_default_lifecycle(metadata_json)
            if default_lifecycle is None:
                raise RuntimeError(f"target entry category {path!r} has no lifecycle default")
            terms[(str(owner_user_id), path)] = (
                str(taxonomy_id),
                str(term_id),
                default_lifecycle,
            )

    missing = sorted(
        (owner, path)
        for owner in owners
        for path in target_paths
        if (owner, path) not in terms
    )
    if missing:
        raise RuntimeError(f"database is missing required entry-category terms: {missing}")
    return terms


def _load_needs_review_tag_ids(
    connection: Connection,
    owner_user_ids: set[str],
) -> dict[str, int]:
    if not owner_user_ids:
        return {}
    return {
        str(owner_user_id): int(tag_id)
        for owner_user_id, tag_id in connection.execute(
            text(
                """
                SELECT owner_user_id, id
                FROM tags
                WHERE name = 'needs_review' AND owner_user_id IN :owner_ids
                """
            ).bindparams(bindparam("owner_ids", expanding=True)),
            {"owner_ids": sorted(owner_user_ids)},
        ).all()
    }


def apply_classifications(
    engine: Engine,
    classifications: list[Classification],
    *,
    apply: bool,
) -> dict[str, Any]:
    entry_ids = [entry_id for row in classifications for entry_id in row.entry_ids]
    target_paths = {row.target_path for row in classifications}
    confidence_counts = Counter(row.confidence for row in classifications)
    target_entry_counts: Counter[str] = Counter()
    for row in classifications:
        target_entry_counts[row.target_path] += len(row.entry_ids)

    with engine.begin() as connection:
        _assert_database_revision(connection)
        entry_states = _load_entry_states(connection, entry_ids)
        target_terms = _load_target_terms(
            connection,
            {state.owner_user_id for state in entry_states.values()},
            target_paths,
        )
        low_confidence_owner_ids = {
            entry_states[entry_id].owner_user_id
            for row in classifications
            if row.confidence == "low"
            for entry_id in row.entry_ids
        }
        needs_review_tag_ids = _load_needs_review_tag_ids(
            connection,
            low_confidence_owner_ids,
        )
        missing_review_tags = sorted(
            low_confidence_owner_ids - set(needs_review_tag_ids)
        )
        if missing_review_tags:
            raise RuntimeError(
                "low-confidence classifications require a needs_review tag for owners: "
                f"{missing_review_tags}"
            )
        if apply:
            now = datetime.now(timezone.utc)
            for row in classifications:
                for entry_id in row.entry_ids:
                    entry_state = entry_states[entry_id]
                    taxonomy_id, term_id, target_lifecycle = target_terms[
                        (entry_state.owner_user_id, row.target_path)
                    ]
                    connection.execute(
                        text(
                            """
                            DELETE FROM taxonomy_assignments
                            WHERE taxonomy_id = :taxonomy_id
                              AND subject_type = 'entry'
                              AND subject_id = :entry_id
                            """
                        ),
                        {"taxonomy_id": taxonomy_id, "entry_id": entry_id},
                    )
                    connection.execute(
                        text(
                            """
                            INSERT INTO taxonomy_assignments
                                (id, taxonomy_id, term_id, subject_type, subject_id,
                                 position, created_at, updated_at)
                            VALUES
                                (:id, :taxonomy_id, :term_id, 'entry', :entry_id,
                                 0, :now, :now)
                            """
                        ),
                        {
                            "id": str(uuid4()),
                            "taxonomy_id": taxonomy_id,
                            "term_id": term_id,
                            "entry_id": entry_id,
                            "now": now,
                        },
                    )
                    if (
                        entry_state.lifecycle is None
                        or entry_state.lifecycle == entry_state.category_default_lifecycle
                    ):
                        connection.execute(
                            text("UPDATE entries SET lifecycle = :lifecycle WHERE id = :entry_id"),
                            {"lifecycle": target_lifecycle, "entry_id": entry_id},
                        )
                    if row.confidence == "low":
                        tag_id = needs_review_tag_ids[entry_state.owner_user_id]
                        connection.execute(
                            text(
                                """
                                INSERT INTO entry_tags (entry_id, tag_id)
                                SELECT :entry_id, :tag_id
                                WHERE NOT EXISTS (
                                    SELECT 1 FROM entry_tags
                                    WHERE entry_id = :entry_id AND tag_id = :tag_id
                                )
                                """
                            ),
                            {"entry_id": entry_id, "tag_id": tag_id},
                        )

    return {
        "applied": apply,
        "signature_count": len(classifications),
        "entry_count": len(entry_ids),
        "confidence_counts": dict(sorted(confidence_counts.items())),
        "target_entry_counts": dict(sorted(target_entry_counts.items())),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate or apply an audited entry-category classification backfill."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--classifications", type=Path, required=True)
    parser.add_argument("--database-url", default=get_settings().database_url)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the validated classifications. The default is a read-only dry run.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    classifications = load_classifications(args.input, args.classifications)
    engine = build_engine_for_url(args.database_url)
    try:
        summary = apply_classifications(engine, classifications, apply=args.apply)
    finally:
        engine.dispose()
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
