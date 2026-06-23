/**
 * CALLING SPEC:
 * - Purpose: define shared finance and grouping primitive types for the frontend.
 * - Inputs: frontend modules that import shared enum-style unions and payload primitives.
 * - Outputs: core type aliases and group member payload contracts.
 * - Side effects: type declarations only.
 */

export type EntryKind = "EXPENSE" | "INCOME" | "TRANSFER";
export type EntryLifecycle = "fixed" | "day_to_day" | "one_time";
export type GroupSource = "manual" | "rule";
export type GroupMemberOverride = "include" | "exclude";

export interface GroupMemberCreatePayload {
  entry_id: string;
  override?: GroupMemberOverride | null;
}
