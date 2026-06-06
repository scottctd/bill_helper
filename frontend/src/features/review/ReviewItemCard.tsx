/**
 * CALLING SPEC:
 * - Purpose: unified read-only proposal review card for import and agent modals.
 * - Inputs: ReviewItemView with header metadata, summary, context, outcome, and fields.
 * - Outputs: review card markup using shared agent-review-* styles.
 * - Side effects: none.
 */

import { cn } from "../../lib/utils";
import { ReviewCardHeader } from "./ReviewCardHeader";
import { ReviewCardSection } from "./ReviewCardSection";
import { ReviewContextList } from "./ReviewContextList";
import { ReviewFieldList } from "./ReviewFieldList";
import { ReviewOutcomeList } from "./ReviewOutcomeList";
import { ReviewSummary } from "./ReviewSummary";
import { reviewModeClass } from "./helpers";
import type { ReviewItemView } from "./types";

export interface ReviewItemCardProps {
  item: ReviewItemView;
  onOpenSourceTask?: (taskId: string) => void;
}

export function ReviewItemCard({ item, onOpenSourceTask }: ReviewItemCardProps) {
  const hasContext = (item.context?.length ?? 0) > 0;
  const hasOutcome = (item.outcome?.length ?? 0) > 0;

  return (
    <article
      key={item.id}
      className={cn("agent-review-card", reviewModeClass(item.changeType), "agent-review-card-animated")}
    >
      <ReviewCardHeader title={item.title} metadata={item.cardMetadata ?? []} onOpenSourceTask={onOpenSourceTask} />
      <div className="agent-review-card-body">
        {item.summary && item.summary.length > 0 ? (
          <ReviewCardSection>
            <ReviewSummary parts={item.summary} />
          </ReviewCardSection>
        ) : null}
        {hasContext ? (
          <ReviewCardSection title="Context">
            <ReviewContextList lines={item.context ?? []} />
          </ReviewCardSection>
        ) : null}
        {item.fields ? (
          <ReviewCardSection title="Details">
            <ReviewFieldList itemKey={item.id} fields={item.fields} />
          </ReviewCardSection>
        ) : null}
        {hasOutcome ? (
          <ReviewCardSection title="Outcome">
            <ReviewOutcomeList lines={item.outcome ?? []} />
          </ReviewCardSection>
        ) : null}
      </div>
    </article>
  );
}
