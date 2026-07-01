# CALLING SPEC:
# - Purpose: expose external-agent session and source APIs.
# - Inputs: authenticated HTTP requests with JSON or multipart file payloads.
# - Outputs: session/source response schemas.
# - Side effects: creates and updates agent thread sessions plus user source links.
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_agent_sessions import (
    AgentSessionCreate,
    AgentSessionListRead,
    AgentSessionRead,
    AgentSessionSourceListRead,
    AgentSessionSourceRead,
    AgentSessionSourceTextCreate,
    AgentSessionUpdate,
)
from backend.services.agent.work_sessions import (
    attach_file_source_to_work_session,
    attach_text_source_to_work_session,
    list_work_session_sources,
    list_work_sessions,
    load_work_session,
    session_source_to_read,
    work_session_to_read,
    create_work_session,
    update_work_session,
)
from backend.services.runtime_settings import resolve_runtime_settings


router = APIRouter(
    prefix="/agent",
    tags=["agent"],
)


@router.get("/sessions", response_model=AgentSessionListRead)
def list_sessions(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionListRead:
    return AgentSessionListRead(sessions=list_work_sessions(db, principal=principal))


@router.post("/sessions", response_model=AgentSessionRead, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: AgentSessionCreate | None = None,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionRead:
    payload = payload or AgentSessionCreate()
    thread = create_work_session(
        db,
        principal=principal,
        title=payload.title,
        summary=payload.summary,
    )
    db.commit()
    db.refresh(thread)
    return work_session_to_read(db, thread=thread, principal=principal)


@router.get("/sessions/{session_id}", response_model=AgentSessionRead)
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionRead:
    thread = load_work_session(db, principal=principal, session_id=session_id)
    return work_session_to_read(db, thread=thread, principal=principal)


@router.patch("/sessions/{session_id}", response_model=AgentSessionRead)
def update_session(
    session_id: str,
    payload: AgentSessionUpdate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionRead:
    thread = update_work_session(
        db,
        principal=principal,
        session_id=session_id,
        title=payload.title,
        title_is_set="title" in payload.model_fields_set,
        summary=payload.summary,
        summary_is_set="summary" in payload.model_fields_set,
    )
    db.commit()
    db.refresh(thread)
    return work_session_to_read(db, thread=thread, principal=principal)


@router.get("/sessions/{session_id}/sources", response_model=AgentSessionSourceListRead)
def list_session_sources(
    session_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionSourceListRead:
    return AgentSessionSourceListRead(
        sources=list_work_session_sources(db, principal=principal, session_id=session_id)
    )


@router.post(
    "/sessions/{session_id}/sources/text",
    response_model=AgentSessionSourceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_session_text_source(
    session_id: str,
    payload: AgentSessionSourceTextCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionSourceRead:
    source = attach_text_source_to_work_session(
        db,
        principal=principal,
        session_id=session_id,
        text=payload.text,
        filename=payload.filename,
        display_name=payload.display_name,
        note=payload.note,
    )
    db.commit()
    db.refresh(source)
    return session_source_to_read(source)


@router.post(
    "/sessions/{session_id}/sources",
    response_model=AgentSessionSourceRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_session_file_source(
    session_id: str,
    note: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentSessionSourceRead:
    file_bytes = await file.read()
    settings = resolve_runtime_settings(db)
    if len(file_bytes) > settings.agent_max_image_size_bytes:
        # Transport: multipart payload size guard before service intake.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source too large. Max bytes allowed is {settings.agent_max_image_size_bytes}.",
        )
    source = attach_file_source_to_work_session(
        db,
        principal=principal,
        session_id=session_id,
        file_bytes=file_bytes,
        original_filename=file.filename,
        mime_type=file.content_type,
        note=note,
    )
    db.commit()
    db.refresh(source)
    return session_source_to_read(source)
