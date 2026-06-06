/**
 * CALLING SPEC:
 * - Purpose: render resolved proposal outcome rows.
 * - Inputs: labeled outcome lines for reviewed proposals.
 * - Outputs: compact outcome definition list markup with optional code blocks.
 * - Side effects: none.
 */

import type { ReviewOutcomeLine } from "./types";

export interface ReviewOutcomeListProps {
  lines: ReviewOutcomeLine[];
}

export function ReviewOutcomeList({ lines }: ReviewOutcomeListProps) {
  return (
    <dl className="agent-review-outcome-list">
      {lines.map((line) => (
        <div key={`${line.label}:${line.value}`} className="agent-review-outcome-row">
          <dt className="agent-review-outcome-label">{line.label}</dt>
          <dd className="agent-review-outcome-value">
            {line.kind === "code" ? (
              <pre className="agent-review-outcome-code">
                <code>{line.value}</code>
              </pre>
            ) : (
              line.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
