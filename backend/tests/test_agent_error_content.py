from backend.services.agent.runtime_support.error_content import (
    format_error_code_block,
    format_model_error_assistant_content,
    format_unexpected_error_assistant_content,
)


def test_format_error_code_block_wraps_trimmed_text() -> None:
    assert format_error_code_block("  model request failed: boom  ") == "```\nmodel request failed: boom\n```"


def test_format_model_error_assistant_content_includes_preamble_and_fence() -> None:
    content = format_model_error_assistant_content("model request failed: unsupported tools")
    assert "language model request failed" in content
    assert "```\nmodel request failed: unsupported tools\n```" in content


def test_format_unexpected_error_assistant_content_includes_preamble_and_fence() -> None:
    content = format_unexpected_error_assistant_content("database unavailable")
    assert "internal error" in content
    assert "```\ndatabase unavailable\n```" in content
