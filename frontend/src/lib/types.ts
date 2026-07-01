/**
 * CALLING SPEC:
 * - Purpose: provide a thin compatibility barrel for frontend type modules.
 * - Inputs: frontend modules that still import the legacy `frontend/src/lib/types.ts` path.
 * - Outputs: re-exported domain type modules.
 * - Side effects: module export wiring only.
 */

export * from "./types/import";
export * from "./types/accounts";
export * from "./types/agent";
export * from "./types/auth";
export * from "./types/catalogs";
export * from "./types/core";
export * from "./types/dashboard";
export * from "./types/entries";
export * from "./types/groups";
export type {
  GroupRead,
  GroupRule,
  GroupRuleCondition,
  GroupRuleField,
  GroupRuleGroup,
  GroupRuleInput,
  GroupRuleNode,
  GroupSummary
} from "./types/groups";
export * from "./types/settings";
