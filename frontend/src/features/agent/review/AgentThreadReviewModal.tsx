/**
 * CALLING SPEC:
 * - Purpose: render the `AgentThreadReviewModal` React UI module.
 * - Inputs: callers that import `frontend/src/features/agent/review/AgentThreadReviewModal.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `AgentThreadReviewModal`.
 * - Side effects: React rendering and user event wiring.
 */
import { useMemo } from "react";

import { ReviewItemCard } from "../../review/ReviewItemCard";
import { ReviewPanel } from "../../review/ReviewPanel";
import { ReviewToc } from "../../review/ReviewToc";
import { mapThreadReviewItemToReviewItemView, mapThreadReviewItemsToReviewItems } from "../../review/mapThreadReviewItem";
import { ReviewModalControls } from "./ReviewModalControls";
import { ReviewModalHeader } from "./ReviewModalHeader";
import type { AgentThreadReviewModalProps } from "./modalTypes";
import { useAgentThreadReviewController } from "./useAgentThreadReviewController";

export function AgentThreadReviewModal(props: AgentThreadReviewModalProps) {
  const controller = useAgentThreadReviewController(props);
  const tocItems = useMemo(
    () => mapThreadReviewItemsToReviewItems(controller.items),
    [controller.items]
  );
  const activeItem = useMemo(
    () =>
      controller.activeReviewItem
        ? mapThreadReviewItemToReviewItemView(controller.activeReviewItem, { allItems: controller.items })
        : null,
    [controller.activeReviewItem, controller.items]
  );

  if (!props.open) {
    return null;
  }

  const activeCard = activeItem ? (
    <ReviewItemCard item={activeItem} />
  ) : (
    <div className="agent-review-empty-card">
      <p className="muted">{controller.items.length === 0 ? "No proposals in this thread." : "Select a proposal to review."}</p>
    </div>
  );

  return (
    <ReviewPanel
      open={props.open}
      embedded={props.embedded}
      onOpenChange={props.onOpenChange}
      isSidebarCollapsed={controller.isSidebarCollapsed}
      header={<ReviewModalHeader controller={controller} />}
      controls={<ReviewModalControls controller={controller} isBusy={props.isBusy} />}
      sidebar={
        <ReviewToc
          items={tocItems}
          activeItemId={controller.activeItemId}
          onSelect={controller.setActiveItemId}
        />
      }
      activeCard={activeCard}
    />
  );
}
