/**
 * CALLING SPEC:
 * - Purpose: provide the `modalHelpers` frontend module.
 * - Inputs: callers that import `frontend/src/features/agent/review/modalHelpers.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `modalHelpers`.
 * - Side effects: module-local frontend behavior only.
 */
import type { AgentChangeItem, AgentChangeStatus, Currency } from "../../../lib/types";
import { isPendingReviewStatus, shortId, type ThreadReviewItem } from "./model";

export const KIND_OPTIONS = [
  { value: "EXPENSE", label: "Expense" },
  { value: "INCOME", label: "Income" },
  { value: "TRANSFER", label: "Transfer" }
] as const;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function proposalReferenceId(record: Record<string, unknown>, idKey: string, proposalKey: string): string | null {
  const directId = record[idKey];
  if (typeof directId === "string" && directId.trim()) {
    return directId;
  }
  const proposalId = record[proposalKey];
  if (typeof proposalId === "string" && proposalId.trim()) {
    return proposalId;
  }
  return null;
}

export function isUnresolvedDependency(proposal: ThreadReviewItem | null): boolean {
  return proposal != null && proposal.item.status !== "APPLIED";
}

export function proposalReferenceLabel(record: Record<string, unknown>, idKey: string, proposalKey: string): string {
  const directId = record[idKey];
  if (typeof directId === "string" && directId.trim()) {
    return directId;
  }
  const proposalId = record[proposalKey];
  if (typeof proposalId === "string" && proposalId.trim()) {
    return `Pending ${shortId(proposalId)}`;
  }
  return "Unresolved";
}

export function prettyDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Review action failed.";
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [role='combobox']"));
}

export function replaceItem(items: ThreadReviewItem[], updated: AgentChangeItem): ThreadReviewItem[] {
  return items.map((reviewItem) => {
    if (reviewItem.item.id !== updated.id) {
      return reviewItem;
    }
    return {
      ...reviewItem,
      item: updated
    };
  });
}

export function findNextPendingItemId(items: ThreadReviewItem[], currentItemId: string | null): string | null {
  const pendingItems = items.filter((reviewItem) => isPendingReviewStatus(reviewItem.item.status));
  if (pendingItems.length === 0) {
    return null;
  }
  if (!currentItemId) {
    return pendingItems[0].item.id;
  }
  const currentIndex = pendingItems.findIndex((reviewItem) => reviewItem.item.id === currentItemId);
  if (currentIndex < 0) {
    return pendingItems[0].item.id;
  }
  return pendingItems[currentIndex + 1]?.item.id ?? pendingItems[currentIndex - 1]?.item.id ?? pendingItems[0].item.id;
}

export function findRelativeItemId(items: ThreadReviewItem[], currentItemId: string | null, delta: number): string | null {
  if (items.length === 0) {
    return null;
  }
  if (!currentItemId) {
    return items[0].item.id;
  }
  const currentIndex = items.findIndex((reviewItem) => reviewItem.item.id === currentItemId);
  if (currentIndex < 0) {
    return items[0].item.id;
  }
  const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + delta));
  return items[nextIndex]?.item.id ?? null;
}

export function collectCurrencyOptions(currencies: Currency[], draftCurrencyCode?: string): string[] {
  const codes = new Set(currencies.map((currency) => currency.code));
  if (draftCurrencyCode) {
    codes.add(draftCurrencyCode.toUpperCase());
  }
  return Array.from(codes).sort();
}

export function resolveProposalItemByReference(items: ThreadReviewItem[], referenceId: string | null): ThreadReviewItem | null {
  if (!referenceId) {
    return null;
  }
  const normalizedReference = referenceId.toLowerCase();
  const exactMatch = items.find((item) => item.item.id.toLowerCase() === normalizedReference);
  if (exactMatch) {
    return exactMatch;
  }
  return items.find((item) => item.item.id.toLowerCase().startsWith(normalizedReference)) ?? null;
}

export function isEditableReviewStatus(status: AgentChangeStatus): boolean {
  return status !== "APPLIED";
}
