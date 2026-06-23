# CALLING SPEC:
# - Purpose: build multimodal LLM parts for agent attachment bundles.
# - Inputs: persisted ``AgentTranscriptAttachment`` rows and assembly options.
# - Outputs: OpenAI-style content part dicts.
# - Side effects: reads canonical files from disk.
from __future__ import annotations

import base64
import logging
import mimetypes
import re
from pathlib import Path
from typing import Any

from backend.models_agent import AgentTranscriptAttachment
from backend.services.agent.agent_attachment_bundle import (
    is_docling_bundle_primary_stored_path,
    pdf_pages_as_png_bytes,
)
from backend.services.agent.attachment_mime_types import is_text_agent_attachment

logger = logging.getLogger(__name__)

_MARKDOWN_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_PAGE_PNG_RE = re.compile(r"^page-(\d+)\.png$", re.IGNORECASE)


def is_pdf_attachment(attachment: AgentTranscriptAttachment) -> bool:
    mime_type = (attachment.mime_type or "").lower()
    if mime_type == "application/pdf":
        return True
    return Path(attachment.file_path).suffix.lower() == ".pdf"


def is_text_attachment(attachment: AgentTranscriptAttachment) -> bool:
    return is_text_agent_attachment(
        mime_type=attachment.mime_type or "",
        original_filename=attachment.original_filename,
    )


def attachment_display_name(attachment: AgentTranscriptAttachment) -> str:
    original_name = " ".join((attachment.original_filename or "").split()).strip()
    if original_name:
        return Path(original_name).name or original_name
    fallback_name = Path(attachment.file_path).name
    return fallback_name or "attachment"


def _vision_image_paths_for_bundle(
    bundle_dir: Path,
    md_text: str,
    *,
    primary_path: Path,
) -> list[Path]:
    seen: set[str] = set()
    ordered: list[Path] = []
    for _alt, raw in _MARKDOWN_IMAGE.findall(md_text):
        base = Path(raw.strip().replace("\\", "/")).name
        candidate = bundle_dir / base
        if (
            candidate.is_file()
            and candidate.resolve() != primary_path.resolve()
            and base not in seen
        ):
            seen.add(base)
            ordered.append(candidate)
    for entry in sorted(bundle_dir.iterdir(), key=lambda item: item.name):
        if not entry.is_file() or entry.name == "parsed.md":
            continue
        if entry.resolve() == primary_path.resolve():
            continue
        if entry.suffix.lower() not in _IMAGE_SUFFIXES:
            continue
        if entry.name in seen:
            continue
        seen.add(entry.name)
        ordered.append(entry)
    return ordered


def _assemble_docling_bundle_parts(
    attachment: AgentTranscriptAttachment,
    *,
    attachment_name: str,
) -> list[dict[str, Any]]:
    primary = Path(attachment.file_path)
    bundle_dir = primary.parent
    parsed_path = bundle_dir / "parsed.md"
    if not parsed_path.is_file():
        return [
            {
                "type": "text",
                "text": (
                    f"Attachment {attachment_name} is missing Docling output (parsed.md). "
                    "Re-upload the file to regenerate the bundle."
                ),
            }
        ]
    md_text = parsed_path.read_text(encoding="utf-8", errors="replace")
    header = (
        f"Attachment {attachment_name} (Docling markdown).\n"
        f"--- parsed.md ---\n{md_text}"
    )
    return [{"type": "text", "text": header}]


def _image_url_part_for_path(path: Path, *, mime_type: str | None = None) -> dict[str, Any]:
    resolved_mime_type = mime_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    data_url = f"data:{resolved_mime_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"
    return {
        "type": "image_url",
        "image_url": {"url": data_url},
    }


def _image_url_part_for_png_bytes(png_bytes: bytes) -> dict[str, Any]:
    data_url = f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}"
    return {
        "type": "image_url",
        "image_url": {"url": data_url},
    }


def _sorted_pdf_page_png_paths(bundle_dir: Path, *, primary_path: Path) -> list[Path]:
    """``page-1.png``, ``page-2.png``, … sorted by page number (vision path, one image per page)."""
    pages: list[tuple[int, Path]] = []
    primary_resolved = primary_path.resolve()
    for entry in bundle_dir.iterdir():
        if not entry.is_file():
            continue
        if entry.resolve() == primary_resolved:
            continue
        match = _PAGE_PNG_RE.match(entry.name)
        if match:
            pages.append((int(match.group(1)), entry))
    pages.sort(key=lambda item: item[0])
    return [path for _, path in pages]


def _assemble_pdf_visual_parts(
    attachment: AgentTranscriptAttachment,
    *,
    attachment_name: str,
) -> list[dict[str, Any]]:
    if not is_docling_bundle_primary_stored_path(attachment.user_file.stored_relative_path):
        return _non_bundle_reupload_parts(attachment_name, is_pdf=True)
    primary = Path(attachment.file_path)
    if not primary.is_file() or primary.suffix.lower() != ".pdf":
        return _non_bundle_reupload_parts(attachment_name, is_pdf=True)
    bundle_dir = primary.parent
    page_paths = _sorted_pdf_page_png_paths(bundle_dir, primary_path=primary)
    image_parts: list[dict[str, Any]]
    if page_paths:
        image_parts = [
            _image_url_part_for_path(path, mime_type=mimetypes.guess_type(path.name)[0])
            for path in page_paths
        ]
    else:
        try:
            png_chunks = pdf_pages_as_png_bytes(primary)
        except Exception:
            logger.exception(
                "pdf_vision_assembly.rasterize_failed attachment_name=%s primary=%s",
                attachment_name,
                primary,
            )
            return [
                {
                    "type": "text",
                    "text": (
                        f"Attachment {attachment_name} could not be rasterized for vision. "
                        "Re-upload the PDF."
                    ),
                }
            ]
        if not png_chunks:
            return [
                {
                    "type": "text",
                    "text": (
                        f"Attachment {attachment_name} has no pages to render for vision. "
                        "Re-upload the PDF."
                    ),
                }
            ]
        image_parts = [_image_url_part_for_png_bytes(chunk) for chunk in png_chunks]

    header = (
        f"Attachment {attachment_name} (PDF, vision path: one image per page, {len(image_parts)} page(s))."
    )
    return [{"type": "text", "text": header}, *image_parts]


def _assemble_image_visual_parts(
    attachment: AgentTranscriptAttachment,
    *,
    attachment_name: str,
) -> list[dict[str, Any]]:
    path = Path(attachment.file_path)
    if not path.is_file():
        return _non_bundle_reupload_parts(attachment_name, is_pdf=False)
    return [
        {"type": "text", "text": f"Attachment {attachment_name} (image)."},
        _image_url_part_for_path(path, mime_type=attachment.mime_type or None),
    ]


def _assemble_text_attachment_parts(
    attachment: AgentTranscriptAttachment,
    *,
    attachment_name: str,
) -> list[dict[str, Any]]:
    path = Path(attachment.file_path)
    if not path.is_file():
        return [
            {
                "type": "text",
                "text": (
                    f"Attachment {attachment_name} could not be read from storage. "
                    "Re-upload the file."
                ),
            }
        ]
    file_text = path.read_text(encoding="utf-8", errors="replace")
    mime_type = (attachment.mime_type or "text/plain").strip() or "text/plain"
    header = (
        f"Attachment {attachment_name} ({mime_type}).\n"
        f"--- file content ---\n{file_text}"
    )
    return [{"type": "text", "text": header}]


def _non_bundle_reupload_parts(attachment_name: str, *, is_pdf: bool) -> list[dict[str, Any]]:
    kind = "PDF" if is_pdf else "image"
    return [
        {
            "type": "text",
            "text": (
                f"Attachment {attachment_name} is not stored as a dated Docling bundle; "
                f"re-upload the {kind} so it can be prepared for vision."
            ),
        }
    ]


def assemble_pdf_attachment_parts(
    attachment: AgentTranscriptAttachment,
    *,
    attachment_name: str,
) -> list[dict[str, Any]]:
    if is_docling_bundle_primary_stored_path(attachment.user_file.stored_relative_path):
        return _assemble_docling_bundle_parts(
            attachment,
            attachment_name=attachment_name,
        )
    return _non_bundle_reupload_parts(attachment_name, is_pdf=True)


def assemble_image_attachment_parts(
    attachment: AgentTranscriptAttachment,
    *,
    attachment_name: str,
) -> list[dict[str, Any]]:
    if is_docling_bundle_primary_stored_path(attachment.user_file.stored_relative_path):
        return _assemble_docling_bundle_parts(
            attachment,
            attachment_name=attachment_name,
        )
    return _non_bundle_reupload_parts(attachment_name, is_pdf=False)


def assemble_attachment_parts(
    attachments: list[AgentTranscriptAttachment],
    *,
    use_ocr: bool = True,
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for attachment in attachments:
        attachment_name = attachment_display_name(attachment)
        if is_text_attachment(attachment):
            parts.extend(
                _assemble_text_attachment_parts(
                    attachment,
                    attachment_name=attachment_name,
                )
            )
            continue
        if is_pdf_attachment(attachment):
            if use_ocr:
                parts.extend(
                    assemble_pdf_attachment_parts(
                        attachment,
                        attachment_name=attachment_name,
                    )
                )
            else:
                parts.extend(
                    _assemble_pdf_visual_parts(
                        attachment,
                        attachment_name=attachment_name,
                    )
                )
            continue
        if use_ocr:
            parts.extend(
                assemble_image_attachment_parts(
                    attachment,
                    attachment_name=attachment_name,
                )
            )
        else:
            parts.extend(
                _assemble_image_visual_parts(
                    attachment,
                    attachment_name=attachment_name,
                )
            )
    return parts
