/**
 * CALLING SPEC:
 * - Purpose: define unified group contracts for the frontend.
 * - Inputs: frontend modules that render group summaries, members, and rules.
 * - Outputs: group-domain type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type GroupRuleField = ApiSchemas["GroupRuleCondition"]["field"];
export type GroupRuleConditionOperator = ApiSchemas["GroupRuleCondition"]["operator"];
export type GroupRuleLogicalOperator = ApiSchemas["GroupRuleGroup-Output"]["operator"];

export type GroupRuleCondition = ApiSchemas["GroupRuleCondition"];
export type GroupRuleGroup = ApiSchemas["GroupRuleGroup-Output"];
export type GroupRuleNode = GroupRuleCondition | GroupRuleGroup;
export type GroupRule = ApiSchemas["GroupRule-Output"];
/** Rule payload shape for group create/update requests. */
export type GroupRuleInput = ApiSchemas["GroupRule-Input"];
export type GroupRuleGroupInput = ApiSchemas["GroupRuleGroup-Input"];

export type GroupMemberRead = ApiSchemas["GroupMemberRead"];
export type GroupSummary = ApiSchemas["GroupSummaryRead"];
export type GroupRead = ApiSchemas["GroupRead"];
