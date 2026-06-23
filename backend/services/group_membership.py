# CALLING SPEC:
# - Purpose: resolve effective group membership for manual and rule groups.
# - Inputs: group rows, member rows, candidate entries, and rule contexts.
# - Outputs: membership checks and effective entry id sets.
# - Side effects: none.
from __future__ import annotations

from backend.enums_finance import GroupMemberOverride, GroupSource
from backend.models_finance import Entry, Group, GroupMember
from backend.schemas_group_rules import GroupRule
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
