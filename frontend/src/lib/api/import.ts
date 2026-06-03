/**
 * CALLING SPEC:
 * - Purpose: HTTP client for import workflow routes.
 * - Inputs: import job create/preflight payloads and job ids.
 * - Outputs: typed import API responses.
 * - Side effects: authenticated HTTP requests.
 */

import type {
  ImportJobBatchApplyResponse,
  ImportJobAggregatedProposal,
  ImportJobCreatePayload,
  ImportJobDetail,
  ImportJobSummary,
  ImportPreflightResponse
} from "../types/import";
import { request } from "./core";

export function preflightImportSources(sourceAttachmentIds: string[]) {
  return request<ImportPreflightResponse>("/api/v1/import/preflight", {
    method: "POST",
    body: JSON.stringify({ source_attachment_ids: sourceAttachmentIds })
  });
}

export function createImportJob(payload: ImportJobCreatePayload) {
  return request<ImportJobDetail>("/api/v1/import/jobs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listImportJobs() {
  return request<ImportJobSummary[]>("/api/v1/import/jobs");
}

export function getImportJob(jobId: string) {
  return request<ImportJobDetail>(`/api/v1/import/jobs/${jobId}`);
}

export function cancelImportJob(jobId: string) {
  return request<ImportJobDetail>(`/api/v1/import/jobs/${jobId}/cancel`, { method: "POST" });
}

export function retryFailedImportTasks(jobId: string) {
  return request<ImportJobDetail>(`/api/v1/import/jobs/${jobId}/retry-failed`, { method: "POST" });
}

export function listImportJobProposals(jobId: string) {
  return request<ImportJobAggregatedProposal[]>(`/api/v1/import/jobs/${jobId}/proposals`);
}

export function batchApproveImportJobProposals(jobId: string, changeItemIds?: string[]) {
  return request<ImportJobBatchApplyResponse>(`/api/v1/import/jobs/${jobId}/proposals/batch-approve`, {
    method: "POST",
    body: JSON.stringify({ change_item_ids: changeItemIds ?? null })
  });
}

export function batchRejectImportJobProposals(jobId: string, changeItemIds?: string[]) {
  return request<ImportJobBatchApplyResponse>(`/api/v1/import/jobs/${jobId}/proposals/batch-reject`, {
    method: "POST",
    body: JSON.stringify({ change_item_ids: changeItemIds ?? null })
  });
}
