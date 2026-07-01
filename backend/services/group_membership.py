# CALLING SPEC:
# - Purpose: resolve effective group membership for manual and rule groups.
# - Inputs: group rows, member rows, candidate entries, rule contexts, and optional
#   request-scoped snapshots loaded via `GroupMembershipContext`.
# - Outputs: membership checks, effective entry id sets, and group lists per entry.
# - Side effects: database reads when building a `GroupMembershipContext` snapshot.
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import GroupMemberOverride, GroupSource
from backend.models_finance import Entry, Group, GroupMember
from backend.schemas_group_rules import GroupRule
from backend.services.group_rule_context import build_entry_rule_context
from backend.services.group_rules import EntryRuleContext, evaluate_group_rule


def sorted_group_members(group: Group) -> list[GroupMember]:
    return sorted(
        group.members,
        key=lambda member: (member.position, member.created_at, member.id),
    )


def manual_member_entry_ids(group: Group) -> set[str]:
    return {
        member.entry_id
        for member in sorted_group_members(group)
        if member.override is None and member.entry is not None and not member.entry.is_deleted
    }


def rule_override_entry_ids(group: Group) -> tuple[set[str], set[str]]:
    includes: set[str] = set()
    excludes: set[str] = set()
    for member in sorted_group_members(group):
        if member.entry is None or member.entry.is_deleted:
            continue
        if member.override == GroupMemberOverride.INCLUDE:
            includes.add(member.entry_id)
        elif member.override == GroupMemberOverride.EXCLUDE:
            excludes.add(member.entry_id)
    return includes, excludes


def effective_entry_ids_for_rule_group(
    group: Group,
    *,
    entries: list[Entry],
    contexts: dict[str, EntryRuleContext],
) -> set[str]:
    rule = GroupRule.model_validate(group.definition_json or {})
    matched = {
        entry.id
        for entry in entries
        if evaluate_group_rule(rule, contexts[entry.id])
    }
    includes, excludes = rule_override_entry_ids(group)
    return (matched - excludes) | includes


def effective_entry_ids_for_group(
    group: Group,
    *,
    entries: list[Entry],
    contexts: dict[str, EntryRuleContext],
) -> set[str]:
    if group.source == GroupSource.MANUAL:
        return manual_member_entry_ids(group)
    return effective_entry_ids_for_rule_group(group, entries=entries, contexts=contexts)


def entry_in_group(
    entry: Entry,
    group: Group,
    *,
    context: EntryRuleContext,
    all_entries: list[Entry] | None = None,
    contexts: dict[str, EntryRuleContext] | None = None,
) -> bool:
    if group.source == GroupSource.MANUAL:
        return entry.id in manual_member_entry_ids(group)
    if all_entries is None or contexts is None:
        rule = GroupRule.model_validate(group.definition_json or {})
        includes, excludes = rule_override_entry_ids(group)
        if entry.id in excludes:
            return False
        if entry.id in includes:
            return True
        return evaluate_group_rule(rule, context)
    return entry.id in effective_entry_ids_for_rule_group(
        group,
        entries=all_entries,
        contexts=contexts,
    )


def groups_for_entry(
    entry: Entry,
    groups: list[Group],
    *,
    context: EntryRuleContext,
    all_entries: list[Entry],
    contexts: dict[str, EntryRuleContext],
) -> list[Group]:
    matched: list[Group] = []
    for group in groups:
        if entry_in_group(
            entry,
            group,
            context=context,
            all_entries=all_entries,
            contexts=contexts,
        ):
            matched.append(group)
    return matched


@dataclass(frozen=True, slots=True)
class GroupMembershipContext:
    groups: tuple[Group, ...]
    entries: tuple[Entry, ...]
    category_paths: dict[str, str]
    account_entity_ids: frozenset[str]
    contexts: dict[str, EntryRuleContext]

    @classmethod
    def load_for_principal(cls, db: Session, *, principal: RequestPrincipal) -> GroupMembershipContext:
        from backend.services.access_scope import entry_owner_filter, group_owner_filter
        from backend.services.groups import group_load_options, list_account_entity_ids_for_principal
        from backend.services.taxonomy import get_entry_category_path_map

        groups = tuple(
            db.scalars(
                select(Group)
                .where(group_owner_filter(principal))
                .options(*group_load_options())
            )
        )
        entries = tuple(
            db.scalars(
                select(Entry)
                .where(Entry.is_deleted.is_(False), entry_owner_filter(principal))
                .options(selectinload(Entry.tags))
            )
        )
        return cls._from_loaded(
            db,
            groups=groups,
            entries=entries,
            account_entity_ids=frozenset(
                list_account_entity_ids_for_principal(db, principal=principal)
            ),
        )

    @classmethod
    def load_for_owner(cls, db: Session, *, owner_user_id: str) -> GroupMembershipContext:
        from backend.services.groups import group_load_options, list_account_entity_ids_for_owner

        groups = tuple(
            db.scalars(
                select(Group)
                .where(Group.owner_user_id == owner_user_id)
                .options(*group_load_options())
            )
        )
        entries = tuple(
            db.scalars(
                select(Entry)
                .where(
                    Entry.owner_user_id == owner_user_id,
                    Entry.is_deleted.is_(False),
                )
                .options(selectinload(Entry.tags))
            )
        )
        return cls._from_loaded(
            db,
            groups=groups,
            entries=entries,
            account_entity_ids=frozenset(list_account_entity_ids_for_owner(db, owner_user_id=owner_user_id)),
        )

    @classmethod
    def _from_loaded(
        cls,
        db: Session,
        *,
        groups: tuple[Group, ...],
        entries: tuple[Entry, ...],
        account_entity_ids: frozenset[str],
    ) -> GroupMembershipContext:
        from backend.services.taxonomy import get_entry_category_path_map

        category_paths = get_entry_category_path_map(db, entry_ids=[entry.id for entry in entries])
        account_ids = set(account_entity_ids)
        contexts = {
            entry.id: build_entry_rule_context(
                entry,
                category_path=category_paths.get(entry.id),
                account_entity_ids=account_ids,
            )
            for entry in entries
        }
        return cls(
            groups=groups,
            entries=entries,
            category_paths=category_paths,
            account_entity_ids=frozenset(account_ids),
            contexts=contexts,
        )

    @property
    def entries_list(self) -> list[Entry]:
        return list(self.entries)

    @property
    def groups_list(self) -> list[Group]:
        return list(self.groups)

    def effective_entry_ids_for_group(self, group: Group) -> set[str]:
        return effective_entry_ids_for_group(
            group,
            entries=self.entries_list,
            contexts=self.contexts,
        )

    def entry_in_group(self, entry: Entry, group: Group) -> bool:
        return entry.id in self.effective_entry_ids_for_group(group)

    def groups_for_entry(self, entry: Entry) -> list[Group]:
        return groups_for_entry(
            entry,
            self.groups_list,
            context=self.contexts[entry.id],
            all_entries=self.entries_list,
            contexts=self.contexts,
        )
