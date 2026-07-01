/**
 * CALLING SPEC:
 * - Purpose: define account, snapshot, and reconciliation read models for the frontend.
 * - Inputs: frontend modules that display account balances, snapshots, and reconciliation summaries.
 * - Outputs: account-domain type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type Account = ApiSchemas["AccountRead"];
export type Snapshot = ApiSchemas["SnapshotRead"];
export type SnapshotSummary = ApiSchemas["SnapshotSummaryRead"];
export type ReconciliationInterval = ApiSchemas["ReconciliationIntervalRead"];
export type Reconciliation = ApiSchemas["ReconciliationRead"];
export type DashboardReconciliation = ApiSchemas["DashboardReconciliationRead"];
