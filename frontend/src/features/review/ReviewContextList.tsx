/**
 * CALLING SPEC:
 * - Purpose: render contextual helper lines for a proposal review card.
 * - Inputs: context lines with optional warning or danger tone.
 * - Outputs: compact context list markup.
 * - Side effects: none.
 */

import { cn } from "../../lib/utils";
import type { ReviewContextLine } from "./types";

export interface ReviewContextListProps {
  lines: ReviewContextLine[];
}

export function ReviewContextList({ lines }: ReviewContextListProps) {
  return (
    <ul className="agent-review-context-list">
      {lines.map((line, index) => (
        <li
          key={`${index}:${line.text}`}
          className={cn(
            "agent-review-context-line",
            line.tone === "warning" && "is-warning",
            line.tone === "danger" && "is-danger"
          )}
        >
          {line.text}
        </li>
      ))}
    </ul>
  );
}
