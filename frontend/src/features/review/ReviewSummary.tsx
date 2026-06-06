/**
 * CALLING SPEC:
 * - Purpose: render the highlighted natural-language proposal summary.
 * - Inputs: structured summary parts with plain and highlight tones.
 * - Outputs: lead summary paragraph markup.
 * - Side effects: none.
 */

import { cn } from "../../lib/utils";
import type { ReviewSummaryPart } from "./types";

export interface ReviewSummaryProps {
  parts: ReviewSummaryPart[];
}

export function ReviewSummary({ parts }: ReviewSummaryProps) {
  return (
    <p className="agent-review-summary">
      {parts.map((part, index) => (
        <span
          key={`${index}:${part.text}`}
          className={cn(part.tone === "highlight" && "agent-review-summary-highlight")}
        >
          {part.text}
        </span>
      ))}
    </p>
  );
}
