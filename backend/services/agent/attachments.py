# CALLING SPEC:
# - Purpose: ingest, attach, resolve, and delete agent transcript attachment files.
# - Inputs: draft uploads, user file ids, transcript message ids, owner scope.
# - Outputs: UserFile rows and AgentTranscriptAttachment bindings.
# - Side effects: DB row creation plus canonical filesystem writes/deletes for agent attachment bundles.
from __future__ import annotations

import shutil

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette import status

from backend.config import get_settings
from backend.models_agent import AgentTranscriptAttachment
from backend.models_files import UserFile
from backend.services.agent.agent_attachment_bundle import (
    ingest_agent_attachment_without_docling,
    pdf_page_count_from_bytes,
)
from backend.services.agent.attachment_mime_types import (
    is_supported_agent_attachment_mime,
    is_text_agent_attachment_mime,
    is_visual_agent_attachment_mime,
    resolve_agent_attachment_mime_type,
)
from backend.services.crud_policy import PolicyViolation
from backend.services.runtime_settings import ResolvedRuntimeSettings
from backend.services.user_files import SOURCE_TYPE_AGENT_ATTACHMENT, resolve_user_file_path


def create_transcript_attachment(
    db: Session,
    *,
    transcript_message_id: str,
    user_file: UserFile,
) -> AgentTranscriptAttachment:
    attachment = AgentTranscriptAttachment(
        transcript_message_id=transcript_message_id,
        user_file_id=user_file.id,
    )
    db.add(attachment)
    db.flush()
    return attachment


_UNSUPPORTED_ATTACHMENT_DETAIL = (
    "Only image, PDF, and plain-text attachments are supported."
)


async def ingest_draft_attachment_upload(
    db: Session,
    *,
    owner_user_id: str,
    upload: UploadFile,
    settings: ResolvedRuntimeSettings,
    use_ocr: bool = True,
) -> UserFile:
    mime_type = resolve_agent_attachment_mime_type(
        mime_type=upload.content_type,
        original_filename=upload.filename,
    )
    if not is_supported_agent_attachment_mime(mime_type):
        raise PolicyViolation(
            detail=_UNSUPPORTED_ATTACHMENT_DETAIL,
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    file_bytes = await upload.read()
    if len(file_bytes) > settings.agent_max_image_size_bytes:
        raise PolicyViolation(
            detail=f"Attachment too large. Max bytes allowed is {settings.agent_max_image_size_bytes}.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    if mime_type == "application/pdf":
        try:
            page_count = pdf_page_count_from_bytes(file_bytes)
        except Exception as exc:
            raise PolicyViolation(
                detail="Attachment could not be read as a PDF.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            ) from exc
        if page_count > settings.agent_max_pdf_pages:
            raise PolicyViolation(
                detail=(
                    f"PDF has {page_count} pages. Max pages allowed is "
                    f"{settings.agent_max_pdf_pages}."
                ),
                status_code=status.HTTP_400_BAD_REQUEST,
            )
    try:
        return ingest_agent_attachment_without_docling(
            db,
            owner_user_id=owner_user_id,
            file_bytes=file_bytes,
            mime_type=mime_type,
            original_filename=upload.filename,
            timezone_name=get_settings().current_user_timezone,
        )
    except RuntimeError as exc:
        detail = (
            "Attachment could not be prepared. Try a different file or format."
            if is_text_agent_attachment_mime(mime_type)
            else "Attachment could not be prepared for vision. Try a different file or format."
        )
        raise PolicyViolation(
            detail=detail,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        ) from exc


def transcript_attachments_require_vision(
    db: Session,
    *,
    files: list[UploadFile],
    attachment_ids: list[str],
    owner_user_id: str,
) -> bool:
    for upload in files:
        mime_type = resolve_agent_attachment_mime_type(
            mime_type=upload.content_type,
            original_filename=upload.filename,
        )
        if is_visual_agent_attachment_mime(mime_type):
            return True

    if not attachment_ids:
        return False

    unique_attachment_ids = list(dict.fromkeys(attachment_ids))
    user_files = list(
        db.scalars(
            select(UserFile).where(
                UserFile.id.in_(unique_attachment_ids),
                UserFile.owner_user_id == owner_user_id,
                UserFile.source_type == SOURCE_TYPE_AGENT_ATTACHMENT,
            )
        )
    )
    return any(is_visual_agent_attachment_mime(user_file.mime_type) for user_file in user_files)


def load_draft_attachment_user_file(
    db: Session,
    *,
    attachment_id: str,
    owner_user_id: str,
) -> UserFile:
    user_file = db.get(UserFile, attachment_id)
    if user_file is None or user_file.owner_user_id != owner_user_id or user_file.source_type != SOURCE_TYPE_AGENT_ATTACHMENT:
        raise PolicyViolation.not_found("Attachment not found.")
    return user_file


def attach_existing_user_files_to_transcript(
    db: Session,
    *,
    attachment_ids: list[str],
    transcript_message_id: str,
    owner_user_id: str,
) -> list[UserFile]:
    if not attachment_ids:
        return []

    unique_attachment_ids = list(dict.fromkeys(attachment_ids))
    user_files = list(
        db.scalars(
            select(UserFile).where(
                UserFile.id.in_(unique_attachment_ids),
                UserFile.owner_user_id == owner_user_id,
                UserFile.source_type == SOURCE_TYPE_AGENT_ATTACHMENT,
            )
        )
    )
    files_by_id = {user_file.id: user_file for user_file in user_files}
    missing_ids = [attachment_id for attachment_id in unique_attachment_ids if attachment_id not in files_by_id]
    if missing_ids:
        raise PolicyViolation.not_found("One or more attachments are unavailable.")
    for attachment_id in attachment_ids:
        create_transcript_attachment(
            db,
            transcript_message_id=transcript_message_id,
            user_file=files_by_id[attachment_id],
        )
    return [files_by_id[attachment_id] for attachment_id in attachment_ids]


def delete_draft_attachment(
    db: Session,
    *,
    attachment_id: str,
    owner_user_id: str,
) -> None:
    user_file = load_draft_attachment_user_file(
        db,
        attachment_id=attachment_id,
        owner_user_id=owner_user_id,
    )
    has_bound_transcript_attachment = db.scalar(
        select(AgentTranscriptAttachment.id)
        .where(AgentTranscriptAttachment.user_file_id == user_file.id)
        .limit(1)
    )
    if has_bound_transcript_attachment:
        raise PolicyViolation(
            detail="Attachment is already bound to a message and cannot be removed.",
            status_code=status.HTTP_409_CONFLICT,
        )
    bundle_dir = resolve_user_file_path(user_file).parent
    db.delete(user_file)
    db.commit()
    shutil.rmtree(bundle_dir, ignore_errors=True)
