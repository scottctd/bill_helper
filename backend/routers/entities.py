# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `entities` routes.
# - Inputs: FastAPI dependencies and validated entity HTTP schemas.
# - Outputs: `EntityRead` responses mapped from service read builders.
# - Side effects: HTTP routing; commits on mutating routes only.
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_finance import EntityCreate, EntityRead, EntityUpdate
from backend.services.access_scope import load_entity_for_principal
from backend.services.entities import (
    build_entity_read,
    create_entity as create_entity_service,
    delete_entity_and_preserve_labels,
    list_entity_reads,
    read_entity_category,
    update_entity as update_entity_service,
)
from backend.services.finance_contracts import EntityCreateCommand, EntityPatch

router = APIRouter(prefix="/entities", tags=["entities"])


@router.get("", response_model=list[EntityRead])
def list_entities(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[EntityRead]:
    return list_entity_reads(db, principal=principal)


@router.post("", response_model=EntityRead, status_code=status.HTTP_201_CREATED)
def create_entity(
    payload: EntityCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntityRead:
    entity = create_entity_service(
        db,
        command=EntityCreateCommand.model_validate(payload.model_dump()),
        principal=principal,
    )
    category = read_entity_category(db, entity)
    db.commit()
    db.refresh(entity)
    return build_entity_read(entity, category=category)


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(
    entity_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    entity = load_entity_for_principal(db, entity_id=entity_id, principal=principal)
    delete_entity_and_preserve_labels(db, entity=entity)
    db.commit()


@router.patch("/{entity_id}", response_model=EntityRead)
def update_entity(
    entity_id: str,
    payload: EntityUpdate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntityRead:
    entity = load_entity_for_principal(db, entity_id=entity_id, principal=principal)
    update_entity_service(
        db,
        entity=entity,
        patch=EntityPatch.model_validate(payload.model_dump(exclude_unset=True)),
    )

    category = read_entity_category(db, entity)
    db.commit()
    db.refresh(entity)
    return build_entity_read(entity, category=category)
