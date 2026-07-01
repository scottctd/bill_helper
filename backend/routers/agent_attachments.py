# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `agent_attachments` routes.
# - Inputs: authenticated multipart uploads and attachment download requests.
# - Outputs: draft attachment schemas and file download responses.
# - Side effects: FastAPI routing; domain errors propagate as PolicyViolation.
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_agent import AgentDraftAttachmentRead
from backend.services.access_scope import load_attachment_for_principal
from backend.services.agent.attachments import delete_draft_attachment, ingest_draft_attachment_upload
from backend.services.runtime_settings import resolve_runtime_settings

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
)


@router.post("/draft-attachments", response_model=AgentDraftAttachmentRead, status_code=status.HTTP_201_CREATED)
async def create_draft_attachment(
    use_ocr: bool = Form(default=False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentDraftAttachmentRead:
    settings = resolve_runtime_settings(db)
    user_file = await ingest_draft_attachment_upload(
        db,
        owner_user_id=principal.user_id,
        upload=file,
        settings=settings,
        use_ocr=use_ocr,
    )
    db.commit()
    db.refresh(user_file)
    return AgentDraftAttachmentRead.model_validate(user_file)


@router.delete("/draft-attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_uploaded_draft_attachment(
    attachment_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    delete_draft_attachment(
        db,
        attachment_id=attachment_id,
        owner_user_id=principal.user_id,
    )


@router.get("/attachments/{attachment_id}")
def get_attachment(
    attachment_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> FileResponse:
    attachment = load_attachment_for_principal(db, attachment_id=attachment_id, principal=principal)
    path = Path(attachment.file_path)
    if not path.exists():
        # Transport: stored path missing on disk after ownership check succeeded.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment file is missing")
    return FileResponse(path, media_type=attachment.mime_type, filename=path.name)
