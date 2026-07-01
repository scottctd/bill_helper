/**
 * CALLING SPEC:
 * - Purpose: define shared finance and grouping primitive types for the frontend.
 * - Inputs: frontend modules that import shared enum-style unions and payload primitives.
 * - Outputs: core type aliases and group member payload contracts from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type EntryKind = ApiSchemas["EntryKind"];
export type EntryLifecycle = ApiSchemas["EntryLifecycle"];
export type GroupSource = ApiSchemas["GroupSource"];
export type GroupMemberOverride = ApiSchemas["GroupMemberOverride"];

export type GroupMemberCreatePayload = ApiSchemas["GroupMemberCreate"];
