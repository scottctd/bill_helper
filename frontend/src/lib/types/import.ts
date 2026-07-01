/**
 * CALLING SPEC:
 * - Purpose: TypeScript contracts for the import workflow API.
 * - Inputs: frontend modules importing import job/task/preflight shapes.
 * - Outputs: import workflow type aliases from generated OpenAPI types.
 * - Side effects: none.
 */

import type { ApiSchemas } from "./schemas";

export type ImportJobStatus = ApiSchemas["ImportJobStatus"];
export type ImportTaskStatus = ApiSchemas["ImportTaskStatus"];
export type ImportPreflightSuggestedAction = ApiSchemas["ImportPreflightFileRead"]["suggested_action"];

export type ImportPriorImport = ApiSchemas["ImportPriorImportRead"];
export type ImportPreflightFile = ApiSchemas["ImportPreflightFileRead"];
export type ImportPreflightResponse = ApiSchemas["ImportPreflightResponse"];
export type ImportTaskRunSummary = ApiSchemas["ImportTaskRunSummaryRead"];
export type ImportTask = ApiSchemas["ImportTaskRead"];
export type ImportJobSummary = ApiSchemas["ImportJobSummaryRead"];
export type ImportJobDetail = ApiSchemas["ImportJobDetailRead"];
export type ImportJobCreatePayload = ApiSchemas["ImportJobCreate"];
export type ImportJobAggregatedProposal = ApiSchemas["ImportJobAggregatedProposalRead"];
export type ImportJobBatchApplyItemResult = ApiSchemas["ImportJobBatchApplyItemResult"];
export type ImportJobBatchApplyResponse = ApiSchemas["ImportJobBatchApplyResponse"];
