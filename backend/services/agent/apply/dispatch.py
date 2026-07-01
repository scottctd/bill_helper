# CALLING SPEC:
# - Purpose: Apply approved agent change payloads for the `dispatch` domain.
# - Inputs: Callers import `backend/services/agent/apply/dispatch` and invoke `apply_change_item_payload`.
# - Outputs: Exports `apply_change_item_payload`.
# - Side effects: May read or write SQLAlchemy sessions and commit domain mutations.
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.enums_agent import AgentChangeType
from backend.services.agent.apply.common import AppliedResource
from backend.services.agent.change_contracts import ChangePayloadModel
from backend.services.agent.change_registry import apply_change_handlers


APPLY_CHANGE_HANDLERS = apply_change_handlers()


def apply_change_item_payload(
    db: Session,
    *,
    change_type: AgentChangeType,
    payload: ChangePayloadModel,
    principal: RequestPrincipal,
) -> AppliedResource:
    handler = APPLY_CHANGE_HANDLERS.get(change_type)
    if handler is None:  # pragma: no cover - enum guard
        raise ValueError(f"Unsupported change type: {change_type}")
    return handler(db, payload, principal)
