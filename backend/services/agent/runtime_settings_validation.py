# CALLING SPEC:
# - Purpose: agent-aware runtime settings derivations for settings read views.
# - Inputs: resolved agent model id, stored API key, and effective available-model list.
# - Outputs: vision-capable model ids and whether provider credentials are configured.
# - Side effects: reads process environment when checking LiteLLM provider credentials.
from __future__ import annotations

from backend.services.agent.attachment_content import model_supports_vision
from backend.services.agent.model_client_support.environment import validate_litellm_environment


def list_vision_capable_agent_models(available_agent_models: list[str]) -> list[str]:
    return [
        model_name
        for model_name in available_agent_models
        if model_supports_vision(model_name)
    ]


def resolve_agent_api_key_configured(*, agent_model: str, stored_api_key: str | None) -> bool:
    if stored_api_key:
        return True
    has_provider_credentials, _, _ = validate_litellm_environment(model_name=agent_model)
    return has_provider_credentials
