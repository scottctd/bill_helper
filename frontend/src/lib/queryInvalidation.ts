/**
 * CALLING SPEC:
 * - Purpose: provide the `queryInvalidation` frontend module.
 * - Inputs: callers that import `frontend/src/lib/queryInvalidation.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `queryInvalidation`.
 * - Side effects: TanStack Query cache invalidation via centralized helpers.
 */
import type { QueryClient } from "@tanstack/react-query";

import { ENTITY_CATEGORY_TAXONOMY_KEY, TAG_TYPE_TAXONOMY_KEY } from "./catalogs";
import { queryKeys } from "./queryKeys";

export function invalidateEntryReadModels(queryClient: QueryClient, entryId?: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.tags });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.entities });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.users });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.currencies });
  if (entryId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.entries.detail(entryId) });
    return;
  }
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.detailRoot });
}

export function invalidateGroupReadModels(queryClient: QueryClient, entryId?: string, groupId?: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  if (groupId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(groupId) });
  }
  if (entryId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.entries.detail(entryId) });
    return;
  }
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.detailRoot });
}

export function invalidateAgentThreadData(queryClient: QueryClient, threadId?: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.agent.threads });
  if (threadId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.agent.thread(threadId) });
    return;
  }
  queryClient.invalidateQueries({ queryKey: queryKeys.agent.threadRoot });
}

export function invalidateRuntimeSettingsReadModels(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.settings.runtime });
  queryClient.invalidateQueries({ queryKey: queryKeys.agent.threads });
  queryClient.invalidateQueries({ queryKey: queryKeys.agent.threadRoot });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.users });
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
}

export function invalidateAccountReadModels(queryClient: QueryClient, accountId?: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.reconciliationRoot });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.snapshotsRoot });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.users });
  if (accountId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts.reconciliation(accountId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts.snapshots(accountId) });
  }
}

export function invalidateEntityReadModels(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.entities });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.taxonomyTerms(ENTITY_CATEGORY_TAXONOMY_KEY) });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
}

export function invalidateTagReadModels(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.tags });
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.taxonomyTerms(TAG_TYPE_TAXONOMY_KEY) });
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
}

export function invalidateUserReadModels(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.users });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
}

export function invalidateAdminReadModels(
  queryClient: QueryClient,
  scope: "users" | "sessions" | "usersAndSessions" = "users"
): void {
  if (scope === "users" || scope === "usersAndSessions") {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.users });
  }
  if (scope === "sessions" || scope === "usersAndSessions") {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.sessions });
  }
}

export function invalidateImportReadModels(
  queryClient: QueryClient,
  options?: {
    jobId?: string;
    threadIds?: string[];
    invalidateEntries?: boolean;
  }
): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.import.jobs });
  if (options?.jobId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.import.job(options.jobId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.import.proposals(options.jobId) });
  }
  for (const threadId of options?.threadIds ?? []) {
    queryClient.invalidateQueries({ queryKey: queryKeys.agent.thread(threadId) });
  }
  if (options?.invalidateEntries) {
    invalidateEntryReadModels(queryClient);
  }
}

export function invalidateTaxonomyReadModels(queryClient: QueryClient, taxonomyKey?: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.properties.taxonomies });
  if (taxonomyKey) {
    queryClient.invalidateQueries({ queryKey: queryKeys.properties.taxonomyTerms(taxonomyKey) });
  } else {
    queryClient.invalidateQueries({ queryKey: queryKeys.properties.taxonomyTermsRoot });
  }

  if (taxonomyKey === ENTITY_CATEGORY_TAXONOMY_KEY) {
    queryClient.invalidateQueries({ queryKey: queryKeys.properties.entities });
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
    return;
  }

  if (taxonomyKey === TAG_TYPE_TAXONOMY_KEY) {
    queryClient.invalidateQueries({ queryKey: queryKeys.properties.tags });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
  }
}
