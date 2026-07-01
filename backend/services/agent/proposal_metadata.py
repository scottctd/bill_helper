# CALLING SPEC:
# - Purpose: expose proposal domain/action/`bh` labels derived from the change-type registry.
# - Inputs: `AgentChangeType` values or their string form from proposal rows and formatters.
# - Outputs: `ProposalMetadata` records for filtering, history prefixes, and HTTP responses.
# - Side effects: none.
from __future__ import annotations

from dataclasses import dataclass

from backend.enums_agent import AgentChangeType
from backend.services.agent.change_registry import CHANGE_TYPE_SPECS


@dataclass(frozen=True, slots=True)
class ProposalMetadata:
    change_action: str
    proposal_type: str
    cli_command: str


def proposal_metadata_for_change_type(change_type: AgentChangeType | str) -> ProposalMetadata:
    if isinstance(change_type, AgentChangeType):
        spec = CHANGE_TYPE_SPECS.get(change_type)
    else:
        spec = next(
            (entry for entry in CHANGE_TYPE_SPECS.values() if entry.change_type.value == str(change_type)),
            None,
        )
    if spec is None:
        return ProposalMetadata("snapshot", "other", "bh proposals get")
    return ProposalMetadata(
        change_action=spec.action,
        proposal_type=spec.domain,
        cli_command=spec.bh_command_label,
    )
