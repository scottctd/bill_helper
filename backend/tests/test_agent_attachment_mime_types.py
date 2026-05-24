from backend.services.agent.attachment_mime_types import (
    is_supported_agent_attachment_mime,
    is_text_agent_attachment_mime,
    is_visual_agent_attachment_mime,
    resolve_agent_attachment_mime_type,
)


def test_resolve_agent_attachment_mime_type_uses_csv_extension_fallback() -> None:
    resolved = resolve_agent_attachment_mime_type(
        mime_type="application/octet-stream",
        original_filename="transactions.csv",
    )
    assert resolved == "text/csv"


def test_is_supported_agent_attachment_mime_accepts_text_and_visual_types() -> None:
    assert is_text_agent_attachment_mime("text/csv")
    assert is_visual_agent_attachment_mime("image/png")
    assert is_visual_agent_attachment_mime("application/pdf")
    assert is_supported_agent_attachment_mime("text/plain")
    assert not is_supported_agent_attachment_mime("application/zip")
