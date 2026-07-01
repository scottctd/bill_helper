# CALLING SPEC:
# - Purpose: agent-aware runtime settings read projection for `GET/PATCH /settings`.
# - Inputs: SQLAlchemy session; core settings resolved by `runtime_settings.py`.
# - Outputs: `RuntimeSettingsView` with derived vision-capable models and credential flags.
# - Side effects: DB reads via core settings helpers; may read env for LiteLLM validation.
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.services.agent.runtime_settings_validation import (
    list_vision_capable_agent_models,
    resolve_agent_api_key_configured,
)
from backend.services.runtime_settings import (
    get_runtime_settings_override,
    resolve_runtime_settings,
)
from backend.services.runtime_settings_contracts import (
    RuntimeSettingsOverridesView,
    RuntimeSettingsView,
)
from backend.validation.runtime_settings import (
    build_effective_agent_model_display_names,
    normalize_currency_code_or_none,
    normalize_text_or_none,
    parse_agent_model_display_names_or_none,
    parse_agent_models_or_none,
    parse_user_memory_or_none,
)


def build_runtime_settings_view(db: Session) -> RuntimeSettingsView:
    override = get_runtime_settings_override(db)
    resolved = resolve_runtime_settings(db)
    effective_display_names = build_effective_agent_model_display_names(
        available_agent_models=resolved.available_agent_models,
        stored_text=override.agent_model_display_names if override else None,
    )
    return RuntimeSettingsView(
        user_memory=resolved.user_memory,
        default_currency_code=resolved.default_currency_code,
        dashboard_currency_code=resolved.dashboard_currency_code,
        agent_model=resolved.agent_model,
        entry_tagging_model=resolved.entry_tagging_model,
        available_agent_models=resolved.available_agent_models,
        agent_model_display_names=effective_display_names,
        vision_capable_agent_models=list_vision_capable_agent_models(
            resolved.available_agent_models
        ),
        agent_max_steps=resolved.agent_max_steps,
        agent_bulk_max_concurrent_threads=resolved.agent_bulk_max_concurrent_threads,
        agent_retry_max_attempts=resolved.agent_retry_max_attempts,
        agent_retry_initial_wait_seconds=resolved.agent_retry_initial_wait_seconds,
        agent_retry_max_wait_seconds=resolved.agent_retry_max_wait_seconds,
        agent_retry_backoff_multiplier=resolved.agent_retry_backoff_multiplier,
        agent_max_image_size_bytes=resolved.agent_max_image_size_bytes,
        agent_max_images_per_message=resolved.agent_max_images_per_message,
        agent_max_pdf_pages=resolved.agent_max_pdf_pages,
        agent_base_url=resolved.agent_base_url,
        agent_api_key_configured=resolve_agent_api_key_configured(
            agent_model=resolved.agent_model,
            stored_api_key=resolved.agent_api_key,
        ),
        overrides=RuntimeSettingsOverridesView(
            user_memory=parse_user_memory_or_none(override.user_memory)
            if override
            else None,
            default_currency_code=normalize_currency_code_or_none(
                override.default_currency_code
            )
            if override
            else None,
            dashboard_currency_code=normalize_currency_code_or_none(
                override.dashboard_currency_code
            )
            if override
            else None,
            agent_model=normalize_text_or_none(override.agent_model)
            if override
            else None,
            entry_tagging_model=normalize_text_or_none(override.entry_tagging_model)
            if override
            else None,
            available_agent_models=parse_agent_models_or_none(override.available_agent_models)
            if override
            else None,
            agent_model_display_names=parse_agent_model_display_names_or_none(
                override.agent_model_display_names
            )
            if override
            else None,
            agent_max_steps=override.agent_max_steps if override else None,
            agent_bulk_max_concurrent_threads=override.agent_bulk_max_concurrent_threads
            if override
            else None,
            agent_retry_max_attempts=override.agent_retry_max_attempts
            if override
            else None,
            agent_retry_initial_wait_seconds=override.agent_retry_initial_wait_seconds
            if override
            else None,
            agent_retry_max_wait_seconds=override.agent_retry_max_wait_seconds
            if override
            else None,
            agent_retry_backoff_multiplier=override.agent_retry_backoff_multiplier
            if override
            else None,
            agent_max_image_size_bytes=override.agent_max_image_size_bytes
            if override
            else None,
            agent_max_images_per_message=override.agent_max_images_per_message
            if override
            else None,
            agent_max_pdf_pages=override.agent_max_pdf_pages
            if override
            else None,
            agent_base_url=normalize_text_or_none(override.agent_base_url)
            if override
            else None,
            agent_api_key_configured=bool(override and override.agent_api_key),
        ),
    )
