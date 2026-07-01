# CALLING SPEC:
# - Purpose: single entry for per-turn model context assembly.
# - Pipeline (linear order):
#   1. system prompt — Jinja shell + user/account context + memory + bh cheat sheet (`prompts.py`)
#   2. prior transcript — canonical user/assistant/tool rows from earlier turns (`thread_context.prior_thread_transcript`)
#   3. review prefixes — compact review outcome lines since last user message (`message_history_prefixes.py`)
#   4. attachment parts — multimodal user content from uploads (`message_history_content.py`)
#   5. user content — review prefix + markdown (+ optional attachment parts) as the current UserMessage
# - Inputs: SQLAlchemy session, thread id, user markdown, attachment parts, surface, turn index.
# - Outputs: harness TranscriptMessage lists via `build_new_turn_transcript` / `build_new_turn_owned_messages`.
# - Side effects: reads transcript rows, settings, taxonomy, attachments, and review actions.
"""Per-turn prompt and transcript assembly for agent model requests."""

from backend.services.agent.prompt_assembly.message_history_content import (
    build_entity_category_context,
    build_user_content,
    build_user_content_from_attachments,
)
from backend.services.agent.prompt_assembly.message_history_prefixes import (
    build_review_results_prefix_for_thread,
)
from backend.services.agent.prompt_assembly.prompts import (
    EXTERNAL_AGENT_PROMPT_TEMPLATE_NAME,
    SYSTEM_PROMPT_TEMPLATE_NAME,
    SystemPromptContext,
    external_agent_prompt,
    system_prompt,
)
from backend.services.agent.prompt_assembly.thread_context import (
    INTERRUPTED_TURN_STEERING_MESSAGE,
    build_new_turn_owned_messages,
    build_new_turn_transcript,
    build_system_message,
    build_user_message,
    next_turn_index,
    prior_thread_transcript,
)
from backend.services.agent.prompt_assembly.user_context import (
    build_current_user_context,
    normalize_account_markdown_for_context,
)

__all__ = [
    "EXTERNAL_AGENT_PROMPT_TEMPLATE_NAME",
    "INTERRUPTED_TURN_STEERING_MESSAGE",
    "SYSTEM_PROMPT_TEMPLATE_NAME",
    "SystemPromptContext",
    "build_current_user_context",
    "build_entity_category_context",
    "build_new_turn_owned_messages",
    "build_new_turn_transcript",
    "build_review_results_prefix_for_thread",
    "build_system_message",
    "build_user_content",
    "build_user_content_from_attachments",
    "build_user_message",
    "external_agent_prompt",
    "next_turn_index",
    "normalize_account_markdown_for_context",
    "prior_thread_transcript",
    "system_prompt",
]
