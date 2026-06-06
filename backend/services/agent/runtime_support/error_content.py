# CALLING SPEC:
# - Purpose: format assistant-facing markdown when agent runs fail.
# - Inputs: callers that import `backend/services/agent/runtime_support/error_content.py`.
# - Outputs: pure string formatters for failed-run assistant messages.
# - Side effects: none.
from __future__ import annotations


def format_error_code_block(error_text: str) -> str:
    trimmed = error_text.strip()
    if not trimmed:
        return ""
    return f"```\n{trimmed}\n```"


def format_model_error_assistant_content(error_text: str) -> str:
    return (
        "I could not complete this run because the language model request failed.\n\n"
        f"{format_error_code_block(error_text)}"
    )


def format_unexpected_error_assistant_content(error_text: str) -> str:
    return (
        "I encountered an internal error while processing this request.\n\n"
        f"{format_error_code_block(error_text)}"
    )
