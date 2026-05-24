# CALLING SPEC:
# - Purpose: classify agent attachment mime types for ingest, validation, and assembly.
# - Inputs: raw mime types and optional original filenames from uploads or persisted files.
# - Outputs: normalized mime helpers and supported-type predicates.
# - Side effects: none.
from __future__ import annotations

import mimetypes
from pathlib import Path

EXPLICIT_PLAIN_TEXT_ATTACHMENT_MIME_TYPES = frozenset(
    {
        "application/csv",
        "application/json",
        "text/csv",
        "text/markdown",
        "text/plain",
        "text/tab-separated-values",
    }
)

PLAIN_TEXT_ATTACHMENT_EXTENSIONS = frozenset(
    {
        ".csv",
        ".json",
        ".log",
        ".md",
        ".tsv",
        ".txt",
        ".xml",
        ".yaml",
        ".yml",
    }
)

_EXTENSION_TO_MIME: dict[str, str] = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".xml": "text/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
}


def normalize_mime_type(value: str | None) -> str:
    return " ".join((value or "").split()).strip().lower()


def mime_type_from_filename(original_filename: str | None) -> str | None:
    suffix = Path(original_filename or "").suffix.lower()
    if suffix in _EXTENSION_TO_MIME:
        return _EXTENSION_TO_MIME[suffix]
    guessed = mimetypes.guess_type(original_filename or "")[0]
    if guessed is None:
        return None
    return normalize_mime_type(guessed)


def is_visual_agent_attachment_mime(mime_type: str) -> bool:
    mime = normalize_mime_type(mime_type)
    return mime == "application/pdf" or mime.startswith("image/")


def is_text_agent_attachment_mime(mime_type: str) -> bool:
    mime = normalize_mime_type(mime_type)
    if mime in EXPLICIT_PLAIN_TEXT_ATTACHMENT_MIME_TYPES:
        return True
    return mime.startswith("text/")


def is_supported_agent_attachment_mime(mime_type: str) -> bool:
    return is_visual_agent_attachment_mime(mime_type) or is_text_agent_attachment_mime(mime_type)


def attachment_filename_suggests_text(original_filename: str | None) -> bool:
    return Path(original_filename or "").suffix.lower() in PLAIN_TEXT_ATTACHMENT_EXTENSIONS


def is_text_agent_attachment(*, mime_type: str, original_filename: str | None = None) -> bool:
    if is_text_agent_attachment_mime(mime_type):
        return True
    if is_visual_agent_attachment_mime(mime_type):
        return False
    return attachment_filename_suggests_text(original_filename)


def resolve_agent_attachment_mime_type(
    *,
    mime_type: str | None,
    original_filename: str | None,
) -> str:
    normalized = normalize_mime_type(mime_type)
    if normalized and is_supported_agent_attachment_mime(normalized):
        return normalized

    from_extension = mime_type_from_filename(original_filename)
    if from_extension and is_supported_agent_attachment_mime(from_extension):
        return from_extension

    if normalized in {"", "application/octet-stream", "binary/octet-stream"}:
        return from_extension or "application/octet-stream"

    return normalized or "application/octet-stream"
