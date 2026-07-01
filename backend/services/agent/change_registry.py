# CALLING SPEC:
# - Purpose: canonical registry of every supported `AgentChangeType` and its proposal wiring.
# - Inputs: callers look up specs by change type for payload models, handlers, labels, and summaries.
# - Outputs: `ChangeTypeSpec` rows, derived lookup dicts, and metadata helpers.
# - Side effects: import-time wiring only.
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from backend.enums_agent import AgentChangeType
from backend.services.agent.apply.catalog import (
    apply_create_account,
    apply_create_entity,
    apply_create_snapshot,
    apply_create_tag,
    apply_delete_account,
    apply_delete_entity,
    apply_delete_snapshot,
    apply_delete_tag,
    apply_update_account,
    apply_update_entity,
    apply_update_tag,
)
from backend.services.agent.apply.common import ChangeApplyHandler
from backend.services.agent.apply.entries import (
    apply_create_entry,
    apply_delete_entry,
    apply_update_entry,
)
from backend.services.agent.apply.groups import (
    apply_create_group,
    apply_create_group_member,
    apply_delete_group,
    apply_delete_group_member,
    apply_update_group,
)
from backend.services.agent.change_contracts import catalog as catalog_contracts
from backend.services.agent.change_contracts import entries as entry_contracts
from backend.services.agent.change_contracts import groups as group_contracts
from backend.services.agent.change_summaries import (
    benchmark_create_entry_prediction,
    benchmark_create_entity_prediction,
    benchmark_create_tag_prediction,
    summarize_create_account_payload,
    summarize_create_entity_payload,
    summarize_create_entry_payload,
    summarize_create_group_member_payload,
    summarize_create_group_payload,
    summarize_create_snapshot_payload,
    summarize_create_tag_payload,
    summarize_delete_account_payload,
    summarize_delete_entity_payload,
    summarize_delete_entry_payload,
    summarize_delete_group_member_payload,
    summarize_delete_group_payload,
    summarize_delete_snapshot_payload,
    summarize_delete_tag_payload,
    summarize_update_account_payload,
    summarize_update_entity_payload,
    summarize_update_entry_payload,
    summarize_update_group_payload,
    summarize_update_tag_payload,
)
from backend.services.agent.proposals.catalog import (
    propose_create_account,
    propose_create_entity,
    propose_create_snapshot,
    propose_create_tag,
    propose_delete_account,
    propose_delete_entity,
    propose_delete_snapshot,
    propose_delete_tag,
    propose_update_account,
    propose_update_entity,
    propose_update_tag,
)
from backend.services.agent.proposals.entries import (
    propose_create_entry,
    propose_delete_entry,
    propose_update_entry,
)
from backend.services.agent.proposals.group_memberships import propose_update_group_membership
from backend.services.agent.proposals.groups import (
    propose_create_group,
    propose_delete_group,
    propose_update_group,
)
from backend.services.agent.proposals.normalization_catalog import CATALOG_PAYLOAD_NORMALIZERS
from backend.services.agent.proposals.normalization_entries import ENTRY_PAYLOAD_NORMALIZERS
from backend.services.agent.proposals.normalization_groups import GROUP_PAYLOAD_NORMALIZERS
from backend.services.agent.tool_args.proposal_admin import ProposeUpdateGroupMembershipArgs
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult

ProposalPayloadNormalizer = Callable[[ToolContext, dict[str, Any]], dict[str, Any]]
ProposalSummarizer = Callable[[Mapping[str, Any]], str]
ProposeHandler = Callable[[ToolContext, Any], ToolExecutionResult]
BenchmarkPredictionBuilder = Callable[[Mapping[str, Any]], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class ChangeTypeSpec:
    change_type: AgentChangeType
    payload_model: type[BaseModel]
    normalizer: ProposalPayloadNormalizer
    apply_handler: ChangeApplyHandler
    domain: str
    action: str
    bh_command_label: str
    review_order_rank: int
    summarize: ProposalSummarizer
    propose_args_model: type[BaseModel]
    propose_handler: ProposeHandler
    stored_payload_model: type[BaseModel] | None = None
    benchmark_prediction: BenchmarkPredictionBuilder | None = None
    benchmark_bucket: str | None = None

    @property
    def effective_stored_payload_model(self) -> type[BaseModel]:
        return self.stored_payload_model or self.payload_model


CHANGE_TYPE_SPECS: dict[AgentChangeType, ChangeTypeSpec] = {
    AgentChangeType.CREATE_TAG: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_TAG,
        payload_model=catalog_contracts.CreateTagPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_TAG],
        apply_handler=apply_create_tag,
        domain="tag",
        action="create",
        bh_command_label="bh tags create",
        review_order_rank=400,
        summarize=summarize_create_tag_payload,
        propose_args_model=catalog_contracts.CreateTagPayload,
        propose_handler=propose_create_tag,
        benchmark_prediction=benchmark_create_tag_prediction,
        benchmark_bucket="tags",
    ),
    AgentChangeType.UPDATE_TAG: ChangeTypeSpec(
        change_type=AgentChangeType.UPDATE_TAG,
        payload_model=catalog_contracts.UpdateTagPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.UPDATE_TAG],
        apply_handler=apply_update_tag,
        domain="tag",
        action="update",
        bh_command_label="bh tags update",
        review_order_rank=401,
        summarize=summarize_update_tag_payload,
        propose_args_model=catalog_contracts.UpdateTagPayload,
        propose_handler=propose_update_tag,
    ),
    AgentChangeType.DELETE_TAG: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_TAG,
        payload_model=catalog_contracts.DeleteTagPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_TAG],
        apply_handler=apply_delete_tag,
        domain="tag",
        action="delete",
        bh_command_label="bh tags remove",
        review_order_rank=402,
        summarize=summarize_delete_tag_payload,
        propose_args_model=catalog_contracts.DeleteTagPayload,
        propose_handler=propose_delete_tag,
    ),
    AgentChangeType.CREATE_ENTITY: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_ENTITY,
        payload_model=catalog_contracts.CreateEntityPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_ENTITY],
        apply_handler=apply_create_entity,
        domain="entity",
        action="create",
        bh_command_label="bh entities create",
        review_order_rank=300,
        summarize=summarize_create_entity_payload,
        propose_args_model=catalog_contracts.CreateEntityPayload,
        propose_handler=propose_create_entity,
        benchmark_prediction=benchmark_create_entity_prediction,
        benchmark_bucket="entities",
    ),
    AgentChangeType.UPDATE_ENTITY: ChangeTypeSpec(
        change_type=AgentChangeType.UPDATE_ENTITY,
        payload_model=catalog_contracts.UpdateEntityPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.UPDATE_ENTITY],
        apply_handler=apply_update_entity,
        domain="entity",
        action="update",
        bh_command_label="bh entities update",
        review_order_rank=301,
        summarize=summarize_update_entity_payload,
        propose_args_model=catalog_contracts.UpdateEntityPayload,
        propose_handler=propose_update_entity,
    ),
    AgentChangeType.DELETE_ENTITY: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_ENTITY,
        payload_model=catalog_contracts.DeleteEntityPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_ENTITY],
        apply_handler=apply_delete_entity,
        domain="entity",
        action="delete",
        bh_command_label="bh entities remove",
        review_order_rank=302,
        summarize=summarize_delete_entity_payload,
        propose_args_model=catalog_contracts.DeleteEntityPayload,
        propose_handler=propose_delete_entity,
    ),
    AgentChangeType.CREATE_ACCOUNT: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_ACCOUNT,
        payload_model=catalog_contracts.CreateAccountPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_ACCOUNT],
        apply_handler=apply_create_account,
        domain="account",
        action="create",
        bh_command_label="bh accounts create",
        review_order_rank=100,
        summarize=summarize_create_account_payload,
        propose_args_model=catalog_contracts.CreateAccountPayload,
        propose_handler=propose_create_account,
    ),
    AgentChangeType.UPDATE_ACCOUNT: ChangeTypeSpec(
        change_type=AgentChangeType.UPDATE_ACCOUNT,
        payload_model=catalog_contracts.UpdateAccountPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.UPDATE_ACCOUNT],
        apply_handler=apply_update_account,
        domain="account",
        action="update",
        bh_command_label="bh accounts update",
        review_order_rank=101,
        summarize=summarize_update_account_payload,
        propose_args_model=catalog_contracts.UpdateAccountPayload,
        propose_handler=propose_update_account,
    ),
    AgentChangeType.DELETE_ACCOUNT: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_ACCOUNT,
        payload_model=catalog_contracts.DeleteAccountPayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_ACCOUNT],
        apply_handler=apply_delete_account,
        domain="account",
        action="delete",
        bh_command_label="bh accounts remove",
        review_order_rank=102,
        summarize=summarize_delete_account_payload,
        propose_args_model=catalog_contracts.DeleteAccountPayload,
        propose_handler=propose_delete_account,
    ),
    AgentChangeType.CREATE_SNAPSHOT: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_SNAPSHOT,
        payload_model=catalog_contracts.SnapshotCreatePayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_SNAPSHOT],
        apply_handler=apply_create_snapshot,
        domain="snapshot",
        action="create",
        bh_command_label="bh snapshots create",
        review_order_rank=200,
        summarize=summarize_create_snapshot_payload,
        propose_args_model=catalog_contracts.ProposeCreateSnapshotArgs,
        propose_handler=propose_create_snapshot,
        stored_payload_model=catalog_contracts.SnapshotCreatePayload,
    ),
    AgentChangeType.DELETE_SNAPSHOT: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_SNAPSHOT,
        payload_model=catalog_contracts.SnapshotDeletePayload,
        normalizer=CATALOG_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_SNAPSHOT],
        apply_handler=apply_delete_snapshot,
        domain="snapshot",
        action="delete",
        bh_command_label="bh snapshots remove",
        review_order_rank=201,
        summarize=summarize_delete_snapshot_payload,
        propose_args_model=catalog_contracts.ProposeDeleteSnapshotArgs,
        propose_handler=propose_delete_snapshot,
        stored_payload_model=catalog_contracts.SnapshotDeletePayload,
    ),
    AgentChangeType.CREATE_ENTRY: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_ENTRY,
        payload_model=entry_contracts.CreateEntryPayload,
        normalizer=ENTRY_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_ENTRY],
        apply_handler=apply_create_entry,
        domain="entry",
        action="create",
        bh_command_label="bh entries create",
        review_order_rank=600,
        summarize=summarize_create_entry_payload,
        propose_args_model=entry_contracts.CreateEntryPayload,
        propose_handler=propose_create_entry,
        benchmark_prediction=benchmark_create_entry_prediction,
        benchmark_bucket="entries",
    ),
    AgentChangeType.UPDATE_ENTRY: ChangeTypeSpec(
        change_type=AgentChangeType.UPDATE_ENTRY,
        payload_model=entry_contracts.UpdateEntryPayload,
        normalizer=ENTRY_PAYLOAD_NORMALIZERS[AgentChangeType.UPDATE_ENTRY],
        apply_handler=apply_update_entry,
        domain="entry",
        action="update",
        bh_command_label="bh entries update",
        review_order_rank=601,
        summarize=summarize_update_entry_payload,
        propose_args_model=entry_contracts.UpdateEntryPayload,
        propose_handler=propose_update_entry,
    ),
    AgentChangeType.DELETE_ENTRY: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_ENTRY,
        payload_model=entry_contracts.DeleteEntryPayload,
        normalizer=ENTRY_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_ENTRY],
        apply_handler=apply_delete_entry,
        domain="entry",
        action="delete",
        bh_command_label="bh entries remove",
        review_order_rank=602,
        summarize=summarize_delete_entry_payload,
        propose_args_model=entry_contracts.DeleteEntryPayload,
        propose_handler=propose_delete_entry,
    ),
    AgentChangeType.CREATE_GROUP: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_GROUP,
        payload_model=group_contracts.CreateGroupPayload,
        normalizer=GROUP_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_GROUP],
        apply_handler=apply_create_group,
        domain="group",
        action="create",
        bh_command_label="bh groups create",
        review_order_rank=500,
        summarize=summarize_create_group_payload,
        propose_args_model=group_contracts.CreateGroupPayload,
        propose_handler=propose_create_group,
    ),
    AgentChangeType.UPDATE_GROUP: ChangeTypeSpec(
        change_type=AgentChangeType.UPDATE_GROUP,
        payload_model=group_contracts.UpdateGroupPayload,
        normalizer=GROUP_PAYLOAD_NORMALIZERS[AgentChangeType.UPDATE_GROUP],
        apply_handler=apply_update_group,
        domain="group",
        action="update",
        bh_command_label="bh groups update",
        review_order_rank=501,
        summarize=summarize_update_group_payload,
        propose_args_model=group_contracts.UpdateGroupPayload,
        propose_handler=propose_update_group,
    ),
    AgentChangeType.DELETE_GROUP: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_GROUP,
        payload_model=group_contracts.DeleteGroupPayload,
        normalizer=GROUP_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_GROUP],
        apply_handler=apply_delete_group,
        domain="group",
        action="delete",
        bh_command_label="bh groups remove",
        review_order_rank=502,
        summarize=summarize_delete_group_payload,
        propose_args_model=group_contracts.DeleteGroupPayload,
        propose_handler=propose_delete_group,
    ),
    AgentChangeType.CREATE_GROUP_MEMBER: ChangeTypeSpec(
        change_type=AgentChangeType.CREATE_GROUP_MEMBER,
        payload_model=group_contracts.CreateGroupMemberPayload,
        normalizer=GROUP_PAYLOAD_NORMALIZERS[AgentChangeType.CREATE_GROUP_MEMBER],
        apply_handler=apply_create_group_member,
        domain="group",
        action="create",
        bh_command_label="bh groups add-member",
        review_order_rank=700,
        summarize=summarize_create_group_member_payload,
        propose_args_model=ProposeUpdateGroupMembershipArgs,
        propose_handler=propose_update_group_membership,
        stored_payload_model=ProposeUpdateGroupMembershipArgs,
    ),
    AgentChangeType.DELETE_GROUP_MEMBER: ChangeTypeSpec(
        change_type=AgentChangeType.DELETE_GROUP_MEMBER,
        payload_model=group_contracts.DeleteGroupMemberPayload,
        normalizer=GROUP_PAYLOAD_NORMALIZERS[AgentChangeType.DELETE_GROUP_MEMBER],
        apply_handler=apply_delete_group_member,
        domain="group",
        action="delete",
        bh_command_label="bh groups remove-member",
        review_order_rank=701,
        summarize=summarize_delete_group_member_payload,
        propose_args_model=ProposeUpdateGroupMembershipArgs,
        propose_handler=propose_update_group_membership,
        stored_payload_model=ProposeUpdateGroupMembershipArgs,
    ),
}


def change_type_spec(change_type: AgentChangeType) -> ChangeTypeSpec:
    spec = CHANGE_TYPE_SPECS.get(change_type)
    if spec is None:  # pragma: no cover - enum guard
        raise ValueError(f"unsupported proposal change type: {change_type.value}")
    return spec


def change_payload_models() -> dict[AgentChangeType, type[BaseModel]]:
    return {change_type: spec.payload_model for change_type, spec in CHANGE_TYPE_SPECS.items()}


def payload_normalizers() -> dict[AgentChangeType, ProposalPayloadNormalizer]:
    return {change_type: spec.normalizer for change_type, spec in CHANGE_TYPE_SPECS.items()}


def apply_change_handlers() -> dict[AgentChangeType, ChangeApplyHandler]:
    return {change_type: spec.apply_handler for change_type, spec in CHANGE_TYPE_SPECS.items()}


def change_type_review_order() -> dict[AgentChangeType, int]:
    return {change_type: spec.review_order_rank for change_type, spec in CHANGE_TYPE_SPECS.items()}


def proposal_summary_for_payload(change_type: AgentChangeType, payload: Mapping[str, Any]) -> str:
    return change_type_spec(change_type).summarize(payload)


__all__ = [
    "CHANGE_TYPE_SPECS",
    "ChangeTypeSpec",
    "apply_change_handlers",
    "change_payload_models",
    "change_type_review_order",
    "change_type_spec",
    "payload_normalizers",
    "proposal_summary_for_payload",
]
