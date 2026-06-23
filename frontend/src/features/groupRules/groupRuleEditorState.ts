/**
 * CALLING SPEC:
 * - Purpose: provide selection and dirty-state helpers for the group rule editor.
 * - Inputs: frontend callers that manage rule-group editor sessions.
 * - Outputs: pure session helpers and submit-payload builders.
 * - Side effects: none.
 */
import type { GroupRead, GroupRule } from "../../lib/types";
import { buildDefaultRule, normalizeRule } from "./groupRuleUtils";

export const DEFAULT_GROUP_RULE_COLOR = "#8f8f8f";

export type GroupRuleEditorTarget = { kind: "new" } | { kind: "existing"; groupId: string };

export interface GroupRuleEditorFormState {
  name: string;
  description: string;
  color: string;
  rule: GroupRule;
}

export type GroupRuleEditorSession =
  | {
      kind: "new";
      formState: GroupRuleEditorFormState;
      baselineState: GroupRuleEditorFormState;
    }
  | {
      kind: "existing";
      groupId: string;
      formState: GroupRuleEditorFormState;
      baselineState: GroupRuleEditorFormState;
    };

function serializeFormState(formState: GroupRuleEditorFormState): string {
  return JSON.stringify({
    name: formState.name.trim(),
    description: formState.description.trim(),
    color: formState.color,
    rule: normalizeRule(formState.rule)
  });
}

export function buildFormState(
  group?: Pick<GroupRead, "name" | "description" | "color" | "rule">
): GroupRuleEditorFormState {
  return {
    name: group?.name ?? "",
    description: group?.description ?? "",
    color: group?.color ?? DEFAULT_GROUP_RULE_COLOR,
    rule: normalizeRule(group?.rule ?? buildDefaultRule())
  };
}

export function createNewEditorSession(): GroupRuleEditorSession {
  const formState = buildFormState();
  return {
    kind: "new",
    formState,
    baselineState: formState
  };
}

export function createExistingEditorSession(group: GroupRead): GroupRuleEditorSession {
  const formState = buildFormState(group);
  return {
    kind: "existing",
    groupId: group.id,
    formState,
    baselineState: formState
  };
}

export function updateSessionFormState(
  session: GroupRuleEditorSession,
  formState: GroupRuleEditorFormState
): GroupRuleEditorSession {
  return {
    ...session,
    formState
  };
}

export function isEditorSessionDirty(session: GroupRuleEditorSession): boolean {
  return serializeFormState(session.formState) !== serializeFormState(session.baselineState);
}

export function isSameEditorTarget(
  session: GroupRuleEditorSession | null,
  target: GroupRuleEditorTarget
): boolean {
  if (!session) {
    return false;
  }
  if (session.kind !== target.kind) {
    return false;
  }
  if (target.kind === "new") {
    return true;
  }
  return session.kind === "existing" && session.groupId === target.groupId;
}

export function toGroupRuleSubmitPayload(formState: GroupRuleEditorFormState) {
  return {
    name: formState.name.trim(),
    description: formState.description.trim() || null,
    color: formState.color || null,
    rule: normalizeRule(formState.rule)
  };
}
