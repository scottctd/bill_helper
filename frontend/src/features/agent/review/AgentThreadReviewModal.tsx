/**
 * CALLING SPEC:
 * - Purpose: render the `AgentThreadReviewModal` React UI module.
 * - Inputs: callers that import `frontend/src/features/agent/review/AgentThreadReviewModal.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `AgentThreadReviewModal`.
 * - Side effects: React rendering and user event wiring.
 */
import { ReviewPanel } from "../../review/ReviewPanel";
import { ReviewTocSection } from "./ReviewEditors";
import { ReviewActiveItemCard } from "./ReviewActiveItemCard";
import { ReviewModalControls } from "./ReviewModalControls";
import { ReviewModalFooter } from "./ReviewModalFooter";
import { ReviewModalHeader } from "./ReviewModalHeader";
import type { AgentThreadReviewModalProps } from "./modalTypes";
import { useAgentThreadReviewController } from "./useAgentThreadReviewController";

export function AgentThreadReviewModal(props: AgentThreadReviewModalProps) {
  const controller = useAgentThreadReviewController(props);

  if (!props.open) {
    return null;
  }

  return (
    <ReviewPanel
      open={props.open}
      embedded={props.embedded}
      onOpenChange={props.onOpenChange}
      isSidebarCollapsed={controller.isSidebarCollapsed}
      header={<ReviewModalHeader controller={controller} />}
      controls={<ReviewModalControls controller={controller} isBusy={props.isBusy} />}
      sidebar={
        <>
          <ReviewTocSection
            title="Pending"
            items={controller.pendingItems}
            activeItemId={controller.activeItemId}
            onSelect={controller.setActiveItemId}
          />
          <ReviewTocSection
            title="Reviewed / Failed"
            items={controller.resolvedItems}
            activeItemId={controller.activeItemId}
            onSelect={controller.setActiveItemId}
          />
        </>
      }
      activeCard={<ReviewActiveItemCard controller={controller} isBusy={props.isBusy} />}
      footer={<ReviewModalFooter controller={controller} />}
    />
  );
}
