/**
 * CALLING SPEC:
 * - Purpose: define unified group contracts for the frontend.
 * - Inputs: frontend modules that render group summaries, members, and rules.
 * - Outputs: group-domain interfaces.
 * - Side effects: type declarations only.
 */

import type { EntryKind, GroupMemberOverride, GroupSource } from "./core";

export type GroupRuleField =
  | "entry_kind"
  | "tags"
  | "is_internal_transfer"
  | "category"
  | "from_entity"
  | "to_entity"
  | "amount_minor"
  | "occurred_at";

export type GroupRuleConditionOperator =
  | "is"
  | "has_any"
  | "has_none"
  | "starts_with"
  | "gte"
  | "lte"
  | "eq"
  | "between"
  | "before"
  | "after";

export type GroupRuleLogicalOperator = "AND" | "OR";

export interface GroupRuleCondition {
  type: "condition";
  field: GroupRuleField;
  operator: GroupRuleConditionOperator;
  value: string | boolean | number | string[] | number[];
}

export interface GroupRuleGroup {
  type: "group";
  operator: GroupRuleLogicalOperator;
  children: GroupRuleNode[];
}

export type GroupRuleNode = GroupRuleCondition | GroupRuleGroup;

export interface GroupRule {
  include: GroupRuleGroup;
  exclude: GroupRuleGroup | null;
}

export interface GroupMemberRead {
  id: string;
  entry_id: string;
  override: GroupMemberOverride | null;
  entry_name: string;
  occurred_at: string;
  kind: EntryKind;
  amount_minor: number;
  currency_code: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  source: GroupSource;
  rule_summary: string | null;
  member_count: number;
  first_occurred_at: string | null;
  last_occurred_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface GroupRead extends GroupSummary {
  members: GroupMemberRead[];
  rule: GroupRule | null;
}
