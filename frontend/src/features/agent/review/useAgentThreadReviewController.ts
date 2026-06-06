/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentThreadReviewController` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/review/useAgentThreadReviewController.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `useAgentThreadReviewController`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { useEffect, useEffectEvent, useMemo, useState } from "react";

import type { AgentChangeItem } from "../../../lib/types";
import {
  findNextPendingItemId,
  findRelativeItemId,
  isEditableReviewStatus,
  isTextInputTarget,
  replaceItem,
  resolveErrorMessage
} from "./modalHelpers";
import { type BatchSummary, type AgentThreadReviewModalProps } from "./modalTypes";
import { buildThreadReviewItems, isPendingReviewStatus, shortId, type ThreadReviewItem } from "./model";

export function useAgentThreadReviewController({
  open,
  threadId,
  runs,
  onApproveItem,
  onRejectItem,
  onReopenItem,
  onBatchApproveItems,
  onBatchRejectItems,
  isBusy = false
}: AgentThreadReviewModalProps) {
  const [items, setItems] = useState<ThreadReviewItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const flattenedItems = useMemo(() => buildThreadReviewItems(runs), [runs]);
  const activeReviewItem = useMemo(() => items.find((item) => item.item.id === activeItemId) ?? null, [activeItemId, items]);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setActiveItemId(null);
      setActionError(null);
      setActionNotice(null);
      setBatchSummary(null);
      setIsBatchRunning(false);
      setIsSidebarCollapsed(false);
      return;
    }
    if (isBatchRunning) {
      return;
    }

    setItems(flattenedItems);
  }, [flattenedItems, isBatchRunning, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (items.length === 0) {
      setActiveItemId(null);
      return;
    }
    if (activeItemId && items.some((item) => item.item.id === activeItemId)) {
      return;
    }
    const nextItemId = items.find((item) => isPendingReviewStatus(item.item.status))?.item.id ?? items[0].item.id;
    setActiveItemId(nextItemId);
  }, [activeItemId, items, open]);

  const pendingItems = useMemo(() => items.filter((item) => isPendingReviewStatus(item.item.status)), [items]);
  const resolvedItems = useMemo(() => items.filter((item) => !isPendingReviewStatus(item.item.status)), [items]);
  const pendingCount = pendingItems.length;

  function mergeUpdatedItem(updated: AgentChangeItem) {
    setItems((current) => replaceItem(current, updated));
  }

  function focusNextPending(currentItemId: string) {
    const nextItemId = findNextPendingItemId(items, currentItemId);
    setActiveItemId(nextItemId ?? currentItemId);
  }

  async function approveReviewItem(reviewItem: ThreadReviewItem): Promise<boolean> {
    try {
      const updated = await onApproveItem({ itemId: reviewItem.item.id });
      mergeUpdatedItem(updated);
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(resolveErrorMessage(error));
      return false;
    }
  }

  async function rejectReviewItem(reviewItem: ThreadReviewItem): Promise<boolean> {
    try {
      const updated = await onRejectItem({ itemId: reviewItem.item.id });
      mergeUpdatedItem(updated);
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(resolveErrorMessage(error));
      return false;
    }
  }

  async function reopenReviewItem(reviewItem: ThreadReviewItem): Promise<boolean> {
    try {
      const updated = await onReopenItem({ itemId: reviewItem.item.id });
      mergeUpdatedItem(updated);
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(resolveErrorMessage(error));
      return false;
    }
  }

  async function handleApproveActive() {
    if (!activeReviewItem || !isActiveEditable || isBusy || isBatchRunning) {
      return;
    }
    setActionNotice(null);
    setBatchSummary(null);
    const wasPending = isPendingReviewStatus(activeReviewItem.item.status);
    const succeeded = await approveReviewItem(activeReviewItem);
    if (succeeded) {
      setActionNotice(`Approved ${shortId(activeReviewItem.item.id)}.`);
      if (wasPending) {
        focusNextPending(activeReviewItem.item.id);
      } else {
        setActiveItemId(activeReviewItem.item.id);
      }
    }
  }

  async function handleRejectActive() {
    if (!activeReviewItem || !isActiveEditable || isBusy || isBatchRunning) {
      return;
    }
    setActionNotice(null);
    setBatchSummary(null);
    const wasPending = isPendingReviewStatus(activeReviewItem.item.status);
    const succeeded = await rejectReviewItem(activeReviewItem);
    if (succeeded) {
      setActionNotice(`Rejected ${shortId(activeReviewItem.item.id)}.`);
      if (wasPending) {
        focusNextPending(activeReviewItem.item.id);
      } else {
        setActiveItemId(activeReviewItem.item.id);
      }
    }
  }

  async function handleReopenActive() {
    if (!activeReviewItem || !isActiveEditable || isBusy || isBatchRunning) {
      return;
    }
    setActionNotice(null);
    setBatchSummary(null);
    const succeeded = await reopenReviewItem(activeReviewItem);
    if (succeeded) {
      setActionNotice(`Moved ${shortId(activeReviewItem.item.id)} to pending review.`);
      setActiveItemId(activeReviewItem.item.id);
    }
  }

  async function handleBatchAction(action: "approve" | "reject") {
    if (isBusy || isBatchRunning || pendingItems.length === 0 || !threadId) {
      return;
    }

    const batchItems = pendingItems.map((reviewItem) => ({ itemId: reviewItem.item.id }));

    setActionError(null);
    setActionNotice(null);
    setBatchSummary(null);
    setIsBatchRunning(true);

    const optimisticStatus = action === "approve" ? "APPLIED" : "REJECTED";
    const pendingIds = new Set(batchItems.map((item) => item.itemId));
    setItems((current) =>
      current.map((reviewItem) =>
        pendingIds.has(reviewItem.item.id)
          ? {
              ...reviewItem,
              item: {
                ...reviewItem.item,
                status: optimisticStatus
              }
            }
          : reviewItem
      )
    );

    try {
      const result =
        action === "approve"
          ? await onBatchApproveItems({ threadId, items: batchItems })
          : await onBatchRejectItems({ threadId, items: batchItems });

      for (const updated of result.items) {
        mergeUpdatedItem(updated);
      }

      setBatchSummary({
        action,
        succeeded: result.summary.succeeded,
        failed: result.summary.failed,
        failedItemIds: result.summary.failedItemIds
      });

      if (result.summary.failedItemIds.length > 0) {
        setActiveItemId(result.summary.failedItemIds[0]);
        setActionError(
          `${result.summary.failed} proposal${result.summary.failed === 1 ? "" : "s"} failed during ${action === "approve" ? "approval" : "rejection"}.`
        );
        return;
      }

      setActionNotice(`${action === "approve" ? "Approved" : "Rejected"} ${result.summary.succeeded} proposal${result.summary.succeeded === 1 ? "" : "s"}.`);
    } catch (error) {
      setActionError(resolveErrorMessage(error));
    } finally {
      setIsBatchRunning(false);
    }
  }

  const handleKeyboardShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (isTextInputTarget(event.target)) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveItemId((current) => findRelativeItemId(items, current, -1));
      return;
    }
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      setActiveItemId((current) => findRelativeItemId(items, current, 1));
      return;
    }
    if ((event.key === "a" || event.key === "A") && activeReviewItem && isEditableReviewStatus(activeReviewItem.item.status)) {
      event.preventDefault();
      void handleApproveActive();
      return;
    }
    if ((event.key === "r" || event.key === "R") && activeReviewItem && isEditableReviewStatus(activeReviewItem.item.status)) {
      event.preventDefault();
      void handleRejectActive();
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      handleKeyboardShortcut(event);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyboardShortcut, open]);

  const nextPendingItemId = findNextPendingItemId(items, activeItemId);
  const isActivePending = activeReviewItem ? isPendingReviewStatus(activeReviewItem.item.status) : false;
  const isActiveEditable = activeReviewItem ? isEditableReviewStatus(activeReviewItem.item.status) : false;

  return {
    actionError,
    actionNotice,
    activeItemId,
    activeReviewItem,
    batchSummary,
    isActiveEditable,
    isActivePending,
    isBatchRunning,
    isSidebarCollapsed,
    items,
    nextPendingItemId,
    pendingCount,
    pendingItems,
    resolvedItems,
    selectRelativeItem(delta: number) {
      setActiveItemId((current) => findRelativeItemId(items, current, delta));
    },
    setActiveItemId,
    toggleSidebar() {
      setIsSidebarCollapsed((current) => !current);
    },
    handleApproveActive,
    handleBatchAction,
    handleRejectActive,
    handleReopenActive
  };
}

export type AgentThreadReviewController = ReturnType<typeof useAgentThreadReviewController>;
