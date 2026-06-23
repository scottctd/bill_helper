# CALLING SPEC:
# - Purpose: implement focused service logic for `taxonomy`.
# - Inputs: callers that import `backend/services/taxonomy.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `taxonomy`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import EntryLifecycle
from backend.models_finance import Taxonomy, TaxonomyAssignment, TaxonomyTerm
from backend.schemas_finance import TaxonomyRead, TaxonomyTermRead
from backend.services.crud_policy import PolicyViolation, map_value_error
from backend.services.taxonomy_constants import ENTRY_CATEGORY_SUBJECT_TYPE, ENTRY_CATEGORY_TAXONOMY_KEY


@dataclass(frozen=True, slots=True)
class TaxonomySpec:
    applies_to: str
    cardinality: str
    display_name: str


DEFAULT_TAXONOMY_SPECS: dict[str, TaxonomySpec] = {
    "entity_category": TaxonomySpec(
        applies_to="entity",
        cardinality="single",
        display_name="Entity Categories",
    ),
    "tag_type": TaxonomySpec(
        applies_to="tag",
        cardinality="single",
        display_name="Tag Types",
    ),
    "entry_category": TaxonomySpec(
        applies_to="entry",
        cardinality="single",
        display_name="Entry Categories",
    ),
}


def normalize_taxonomy_key(key: str) -> str:
    return "_".join(key.strip().lower().split())


def normalize_required_taxonomy_key(key: str) -> str:
    normalized = normalize_taxonomy_key(key)
    if not normalized:
        raise ValueError("Taxonomy key cannot be empty")
    return normalized


def normalize_term_name(name: str) -> str:
    return " ".join(name.split()).strip().lower()


def get_term_description(term: TaxonomyTerm) -> str | None:
    metadata = term.metadata_json
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("description")
    if isinstance(value, str):
        normalized = " ".join(value.split()).strip()
        return normalized or None
    return None


def _normalize_term_description(description: str | None) -> str | None:
    if description is None:
        return None
    normalized = " ".join(description.split()).strip()
    return normalized or None


def set_term_description(term: TaxonomyTerm, description: str | None) -> None:
    normalized = _normalize_term_description(description)
    metadata = dict(term.metadata_json) if isinstance(term.metadata_json, dict) else {}
    if normalized is not None:
        metadata["description"] = normalized
    else:
        metadata.pop("description", None)
    term.metadata_json = metadata or None


def set_term_default_lifecycle(term: TaxonomyTerm, lifecycle: EntryLifecycle | None) -> None:
    metadata = dict(term.metadata_json) if isinstance(term.metadata_json, dict) else {}
    if lifecycle is not None:
        metadata["default_lifecycle"] = lifecycle.value
    else:
        metadata.pop("default_lifecycle", None)
    term.metadata_json = metadata or None


def get_term_default_lifecycle(term: TaxonomyTerm) -> EntryLifecycle | None:
    metadata = term.metadata_json
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("default_lifecycle")
    if not isinstance(value, str):
        return None
    try:
        return EntryLifecycle(value)
    except ValueError:
        return None


def _taxonomy_rows_for_key(
    db: Session,
    *,
    key: str,
) -> list[Taxonomy]:
    normalized_key = normalize_taxonomy_key(key)
    if not normalized_key:
        return []
    return list(
        db.scalars(
            select(Taxonomy)
            .where(Taxonomy.key == normalized_key)
            .order_by(Taxonomy.created_at.asc())
        )
    )


def ensure_taxonomy(
    db: Session,
    *,
    key: str,
    applies_to: str,
    cardinality: str,
    display_name: str,
    owner_user_id: str,
) -> Taxonomy:
    normalized_key = normalize_taxonomy_key(key)
    taxonomy = db.scalar(
        select(Taxonomy).where(
            Taxonomy.owner_user_id == owner_user_id,
            Taxonomy.key == normalized_key,
        )
    )
    if taxonomy is not None:
        return taxonomy

    taxonomy = Taxonomy(
        owner_user_id=owner_user_id,
        key=normalized_key,
        applies_to=applies_to,
        cardinality=cardinality,
        display_name=display_name,
    )
    db.add(taxonomy)
    db.flush()
    return taxonomy


def ensure_default_taxonomies(db: Session, *, owner_user_id: str) -> dict[str, Taxonomy]:
    taxonomies: dict[str, Taxonomy] = {}
    for key, spec in DEFAULT_TAXONOMY_SPECS.items():
        taxonomies[key] = ensure_taxonomy(
            db,
            key=key,
            applies_to=spec.applies_to,
            cardinality=spec.cardinality,
            display_name=spec.display_name,
            owner_user_id=owner_user_id,
        )
    return taxonomies


def list_taxonomy_reads(
    db: Session,
    *,
    principal: RequestPrincipal,
) -> list[TaxonomyRead]:
    ensure_default_taxonomies(db, owner_user_id=principal.user_id)
    rows = list(
        db.scalars(
            select(Taxonomy)
            .where(Taxonomy.owner_user_id == principal.user_id)
            .order_by(Taxonomy.key.asc())
        )
    )
    return [TaxonomyRead.model_validate(row) for row in rows]


def get_taxonomy_by_key(
    db: Session,
    key: str,
    *,
    owner_user_id: str,
) -> Taxonomy | None:
    normalized_key = normalize_taxonomy_key(key)
    return db.scalar(
        select(Taxonomy).where(
            Taxonomy.owner_user_id == owner_user_id,
            Taxonomy.key == normalized_key,
        )
    )


def ensure_taxonomy_by_key(
    db: Session,
    key: str,
    *,
    owner_user_id: str,
) -> Taxonomy:
    normalized_key = normalize_required_taxonomy_key(key)
    taxonomy = get_taxonomy_by_key(db, normalized_key, owner_user_id=owner_user_id)
    if taxonomy is not None:
        return taxonomy
    spec = DEFAULT_TAXONOMY_SPECS.get(normalized_key)
    if spec is None:
        raise ValueError(f"Unknown taxonomy '{normalized_key}'")
    return ensure_taxonomy(
        db,
        key=normalized_key,
        applies_to=spec.applies_to,
        cardinality=spec.cardinality,
        display_name=spec.display_name,
        owner_user_id=owner_user_id,
    )


def load_taxonomy_by_key(
    db: Session,
    key: str,
    *,
    principal: RequestPrincipal,
) -> Taxonomy:
    taxonomy = get_taxonomy_by_key(db, key, owner_user_id=principal.user_id)
    if taxonomy is not None:
        return taxonomy
    if not principal.is_admin:
        raise PolicyViolation.not_found("Taxonomy not found")

    rows = _taxonomy_rows_for_key(db, key=key)
    if not rows:
        raise PolicyViolation.not_found("Taxonomy not found")
    if len(rows) > 1:
        raise PolicyViolation.conflict(
            "Taxonomy key is ambiguous across users. Use admin impersonation to edit a user's taxonomy."
        )
    return rows[0]


def _resolve_parent_term_id(
    db: Session,
    *,
    taxonomy: Taxonomy,
    parent_term_id: str | None,
) -> str | None:
    if parent_term_id is None:
        return None
    parent = db.scalar(
        select(TaxonomyTerm).where(
            TaxonomyTerm.id == parent_term_id,
            TaxonomyTerm.taxonomy_id == taxonomy.id,
        )
    )
    if parent is None:
        raise ValueError("Parent term not found")
    if parent.parent_term_id is not None:
        raise ValueError("Category terms support at most one level of nesting")
    return parent.id


def ensure_term(
    db: Session,
    *,
    taxonomy: Taxonomy,
    name: str,
    parent_term_id: str | None = None,
) -> TaxonomyTerm:
    normalized_name = normalize_term_name(name)
    if not normalized_name:
        raise ValueError("Term name cannot be empty")

    term = db.scalar(
        select(TaxonomyTerm).where(
            TaxonomyTerm.taxonomy_id == taxonomy.id,
            TaxonomyTerm.normalized_name == normalized_name,
        )
    )
    if term is not None:
        return term

    resolved_parent_id = _resolve_parent_term_id(
        db, taxonomy=taxonomy, parent_term_id=parent_term_id
    )
    term = TaxonomyTerm(
        taxonomy_id=taxonomy.id,
        name=normalized_name,
        normalized_name=normalized_name,
        parent_term_id=resolved_parent_id,
    )
    db.add(term)
    db.flush()
    return term


def create_term(
    db: Session,
    *,
    taxonomy: Taxonomy,
    name: str,
    parent_term_id: str | None = None,
) -> TaxonomyTerm:
    normalized_name = normalize_term_name(name)
    if not normalized_name:
        raise ValueError("Term name cannot be empty")

    existing = db.scalar(
        select(TaxonomyTerm).where(
            TaxonomyTerm.taxonomy_id == taxonomy.id,
            TaxonomyTerm.normalized_name == normalized_name,
        )
    )
    if existing is not None:
        raise ValueError("Term already exists")

    resolved_parent_id = _resolve_parent_term_id(
        db, taxonomy=taxonomy, parent_term_id=parent_term_id
    )
    term = TaxonomyTerm(
        taxonomy_id=taxonomy.id,
        name=normalized_name,
        normalized_name=normalized_name,
        parent_term_id=resolved_parent_id,
    )
    db.add(term)
    db.flush()
    return term


def rename_term(db: Session, *, term: TaxonomyTerm, new_name: str) -> TaxonomyTerm:
    normalized_name = normalize_term_name(new_name)
    if not normalized_name:
        raise ValueError("Term name cannot be empty")

    existing = db.scalar(
        select(TaxonomyTerm).where(
            TaxonomyTerm.taxonomy_id == term.taxonomy_id,
            TaxonomyTerm.normalized_name == normalized_name,
        )
    )
    if existing is not None and existing.id != term.id:
        raise ValueError("Term already exists")

    term.name = normalized_name
    term.normalized_name = normalized_name
    db.add(term)
    db.flush()
    return term


def load_taxonomy_term(
    db: Session,
    *,
    taxonomy_id: str,
    term_id: str,
) -> TaxonomyTerm:
    term = db.scalar(
        select(TaxonomyTerm).where(
            TaxonomyTerm.id == term_id,
            TaxonomyTerm.taxonomy_id == taxonomy_id,
        )
    )
    if term is None:
        raise PolicyViolation.not_found("Taxonomy term not found")
    return term


def assign_single_term_by_name(
    db: Session,
    *,
    taxonomy_key: str,
    subject_type: str,
    subject_id: str | int,
    term_name: str | None,
    owner_user_id: str,
) -> TaxonomyTerm | None:
    taxonomy = ensure_taxonomy_by_key(db, taxonomy_key, owner_user_id=owner_user_id)

    normalized_term_name = normalize_term_name(term_name or "") if term_name is not None else ""
    subject_id_str = str(subject_id)

    db.execute(
        delete(TaxonomyAssignment).where(
            TaxonomyAssignment.taxonomy_id == taxonomy.id,
            TaxonomyAssignment.subject_type == subject_type,
            TaxonomyAssignment.subject_id == subject_id_str,
        )
    )

    if not normalized_term_name:
        db.flush()
        return None

    term = ensure_term(db, taxonomy=taxonomy, name=normalized_term_name)
    assignment = TaxonomyAssignment(
        taxonomy_id=taxonomy.id,
        term_id=term.id,
        subject_type=subject_type,
        subject_id=subject_id_str,
    )
    db.add(assignment)
    db.flush()
    return term


def get_single_term_name(
    db: Session,
    *,
    taxonomy_key: str,
    subject_type: str,
    subject_id: str | int,
    owner_user_id: str,
) -> str | None:
    taxonomy = get_taxonomy_by_key(db, taxonomy_key, owner_user_id=owner_user_id)
    if taxonomy is None:
        return None

    row = db.execute(
        select(TaxonomyTerm.name)
        .join(TaxonomyAssignment, TaxonomyAssignment.term_id == TaxonomyTerm.id)
        .where(
            TaxonomyAssignment.taxonomy_id == taxonomy.id,
            TaxonomyAssignment.subject_type == subject_type,
            TaxonomyAssignment.subject_id == str(subject_id),
        )
        .limit(1)
    ).first()
    return str(row[0]) if row else None


def get_single_term_name_map(
    db: Session,
    *,
    taxonomy_key: str,
    subject_type: str,
    subject_ids: list[str | int],
    owner_user_id: str,
) -> dict[str, str]:
    taxonomy = get_taxonomy_by_key(db, taxonomy_key, owner_user_id=owner_user_id)
    if taxonomy is None or not subject_ids:
        return {}

    subject_id_values = [str(value) for value in subject_ids]
    rows = db.execute(
        select(
            TaxonomyAssignment.subject_id,
            TaxonomyTerm.name,
        )
        .join(TaxonomyTerm, TaxonomyTerm.id == TaxonomyAssignment.term_id)
        .where(
            TaxonomyAssignment.taxonomy_id == taxonomy.id,
            TaxonomyAssignment.subject_type == subject_type,
            TaxonomyAssignment.subject_id.in_(subject_id_values),
        )
    ).all()
    return {str(subject_id): str(name) for subject_id, name in rows}


def descendant_term_ids(
    db: Session,
    *,
    taxonomy: Taxonomy,
    parent_term_id: str,
) -> set[str]:
    """Parent term id plus all descendant term ids (depth=1: the parent and its direct children)."""
    child_ids = db.scalars(
        select(TaxonomyTerm.id).where(
            TaxonomyTerm.taxonomy_id == taxonomy.id,
            TaxonomyTerm.parent_term_id == parent_term_id,
        )
    ).all()
    return {parent_term_id, *child_ids}


def get_entry_category_path_map(
    db: Session,
    *,
    entry_ids: list[str],
) -> dict[str, str]:
    """Bulk-resolve each entry's category path: 'housing/rent' (child), 'housing' (top-level), or missing.

    Owner-agnostic: joins the entry_category taxonomy by key so lists with mixed owners resolve correctly.
    """
    if not entry_ids:
        return {}
    entry_id_values = [str(value) for value in entry_ids]
    rows = db.execute(
        select(
            TaxonomyAssignment.subject_id,
            TaxonomyTerm.name,
            TaxonomyTerm.parent_term_id,
        )
        .join(TaxonomyTerm, TaxonomyTerm.id == TaxonomyAssignment.term_id)
        .join(Taxonomy, Taxonomy.id == TaxonomyAssignment.taxonomy_id)
        .where(
            Taxonomy.key == ENTRY_CATEGORY_TAXONOMY_KEY,
            TaxonomyAssignment.subject_type == ENTRY_CATEGORY_SUBJECT_TYPE,
            TaxonomyAssignment.subject_id.in_(entry_id_values),
        )
    ).all()
    parent_ids = {row.parent_term_id for row in rows if row.parent_term_id is not None}
    parent_name_by_id: dict[str, str] = {}
    if parent_ids:
        parent_name_by_id = {
            str(term.id): term.name
            for term in db.scalars(
                select(TaxonomyTerm).where(TaxonomyTerm.id.in_(parent_ids))
            )
        }
    path_map: dict[str, str] = {}
    for subject_id, name, parent_term_id in rows:
        if parent_term_id is not None:
            parent_name = parent_name_by_id.get(str(parent_term_id))
            path = f"{parent_name}/{name}" if parent_name else str(name)
        else:
            path = str(name)
        path_map[str(subject_id)] = path
    return path_map


def entry_category_term_names(db: Session, *, owner_user_id: str) -> set[str]:
    """Normalized names of all entry_category terms for an owner (used to guard the tags field)."""
    taxonomy = get_taxonomy_by_key(
        db, ENTRY_CATEGORY_TAXONOMY_KEY, owner_user_id=owner_user_id
    )
    if taxonomy is None:
        return set()
    return {
        str(name)
        for name in db.scalars(
            select(TaxonomyTerm.normalized_name).where(TaxonomyTerm.taxonomy_id == taxonomy.id)
        )
    }


def entry_category_catalog(db: Session, *, owner_user_id: str) -> list[dict[str, object]]:
    """All entry_category terms for an owner as a catalog: name, path ('housing/rent'), default_lifecycle."""
    taxonomy = get_taxonomy_by_key(
        db, ENTRY_CATEGORY_TAXONOMY_KEY, owner_user_id=owner_user_id
    )
    if taxonomy is None:
        return []
    terms = list(
        db.scalars(
            select(TaxonomyTerm).where(TaxonomyTerm.taxonomy_id == taxonomy.id)
        )
    )
    parent_name_by_id = {term.id: term.name for term in terms if term.parent_term_id is None}
    catalog: list[dict[str, object]] = []
    for term in terms:
        if term.parent_term_id is None:
            path = term.name
            default_lifecycle: EntryLifecycle | None = None
        else:
            parent_name = parent_name_by_id.get(term.parent_term_id)
            path = f"{parent_name}/{term.name}" if parent_name else term.name
            default_lifecycle = get_term_default_lifecycle(term)
        catalog.append(
            {
                "name": term.name,
                "path": path,
                "default_lifecycle": default_lifecycle.value if default_lifecycle else None,
            }
        )
    return catalog


def list_terms_with_usage(
    db: Session,
    *,
    taxonomy: Taxonomy,
) -> list[tuple[TaxonomyTerm, int]]:
    rows = db.execute(
        select(
            TaxonomyTerm,
            func.count(TaxonomyAssignment.id).label("usage_count"),
        )
        .outerjoin(TaxonomyAssignment, TaxonomyAssignment.term_id == TaxonomyTerm.id)
        .where(TaxonomyTerm.taxonomy_id == taxonomy.id)
        .group_by(TaxonomyTerm.id)
        .order_by(func.lower(TaxonomyTerm.name).asc())
    ).all()
    return [(term, int(usage_count or 0)) for term, usage_count in rows]


def build_taxonomy_term_read(
    db: Session,
    *,
    term: TaxonomyTerm,
) -> TaxonomyTermRead:
    usage_count = int(
        db.scalar(
            select(func.count(TaxonomyAssignment.id)).where(TaxonomyAssignment.term_id == term.id)
        )
        or 0
    )
    return TaxonomyTermRead(
        id=term.id,
        taxonomy_id=term.taxonomy_id,
        name=term.name,
        normalized_name=term.normalized_name,
        parent_term_id=term.parent_term_id,
        description=get_term_description(term),
        default_lifecycle=get_term_default_lifecycle(term),
        usage_count=usage_count,
    )


def list_taxonomy_term_reads(
    db: Session,
    *,
    taxonomy_key: str,
    principal: RequestPrincipal,
) -> list[TaxonomyTermRead]:
    taxonomy = load_taxonomy_by_key(db, taxonomy_key, principal=principal)
    rows = list_terms_with_usage(db, taxonomy=taxonomy)
    return [
        TaxonomyTermRead(
            id=term.id,
            taxonomy_id=term.taxonomy_id,
            name=term.name,
            normalized_name=term.normalized_name,
            parent_term_id=term.parent_term_id,
            description=get_term_description(term),
            default_lifecycle=get_term_default_lifecycle(term),
            usage_count=usage_count,
        )
        for term, usage_count in rows
    ]


def create_term_from_payload(
    db: Session,
    *,
    taxonomy_key: str,
    name: str,
    description: str | None,
    parent_term_id: str | None = None,
    default_lifecycle: EntryLifecycle | None = None,
    principal: RequestPrincipal,
) -> TaxonomyTerm:
    try:
        taxonomy = ensure_taxonomy_by_key(
            db,
            taxonomy_key,
            owner_user_id=principal.user_id,
        )
        term = create_term(
            db,
            taxonomy=taxonomy,
            name=name,
            parent_term_id=parent_term_id,
        )
    except ValueError as exc:
        violation = map_value_error(
            exc,
            not_found_patterns=("Unknown taxonomy", "Parent term not found"),
            conflict_patterns=("already exists",),
        )
        if violation.status_code == 404:
            violation.detail = "Taxonomy or parent term not found"
        raise violation from exc

    if description is not None:
        set_term_description(term, description)
    set_term_default_lifecycle(term, default_lifecycle)
    db.add(term)

    return term


def update_term_from_payload(
    db: Session,
    *,
    taxonomy_key: str,
    term_id: str,
    name: str | None,
    description: str | None,
    default_lifecycle: EntryLifecycle | None,
    fields_set: set[str],
    principal: RequestPrincipal,
) -> TaxonomyTerm:
    taxonomy = load_taxonomy_by_key(db, taxonomy_key, principal=principal)
    term = load_taxonomy_term(db, taxonomy_id=taxonomy.id, term_id=term_id)

    if name is not None:
        try:
            rename_term(db, term=term, new_name=name)
        except ValueError as exc:
            raise map_value_error(
                exc,
                conflict_patterns=("already exists",),
            ) from exc
    if "description" in fields_set:
        set_term_description(term, description)
    if "default_lifecycle" in fields_set:
        set_term_default_lifecycle(term, default_lifecycle)
    db.add(term)

    return term


def delete_term_from_payload(
    db: Session,
    *,
    taxonomy_key: str,
    term_id: str,
    principal: RequestPrincipal,
) -> None:
    taxonomy = load_taxonomy_by_key(db, taxonomy_key, principal=principal)
    term = load_taxonomy_term(db, taxonomy_id=taxonomy.id, term_id=term_id)
    child_count = db.scalar(
        select(func.count(TaxonomyTerm.id)).where(
            TaxonomyTerm.taxonomy_id == taxonomy.id,
            TaxonomyTerm.parent_term_id == term.id,
        )
    )
    if child_count:
        raise PolicyViolation.conflict("Delete child terms before deleting their parent")
    db.delete(term)
    db.flush()


def list_term_name_description_pairs(
    db: Session,
    *,
    taxonomy_key: str,
    owner_user_id: str,
) -> list[tuple[str, str | None]]:
    taxonomy = get_taxonomy_by_key(db, taxonomy_key, owner_user_id=owner_user_id)
    if taxonomy is None:
        return []

    terms = list(
        db.scalars(
            select(TaxonomyTerm)
            .where(TaxonomyTerm.taxonomy_id == taxonomy.id)
            .order_by(func.lower(TaxonomyTerm.name).asc())
        )
    )
    return [(term.name, get_term_description(term)) for term in terms]
