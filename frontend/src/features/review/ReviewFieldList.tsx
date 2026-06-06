/**
 * CALLING SPEC:
 * - Purpose: render compact read-only proposal fields for review cards.
 * - Inputs: ProposalFields rows and stable item key for React keys.
 * - Outputs: definition-list field markup with update arrows for changed values.
 * - Side effects: none.
 */

import { cn } from "../../lib/utils";
import type { ProposalFields } from "./proposalFields";

export interface ReviewFieldListProps {
  itemKey: string;
  fields: ProposalFields;
}

export function ReviewFieldList({ itemKey, fields }: ReviewFieldListProps) {
  if (fields.rows.length === 0) {
    return <p className="muted text-sm">No fields.</p>;
  }

  return (
    <div className="agent-review-field-panel">
      <dl className="agent-review-field-list" aria-label="Proposal fields">
        {fields.rows.map((row) => (
          <div key={`${itemKey}:${row.label}`} className="agent-review-field-row">
            <dt className="agent-review-field-label">{row.label}</dt>
            <dd className="agent-review-field-value">
              {fields.mode === "update" ? (
                <span className="agent-review-field-change">
                  {row.before ? <span className="agent-review-field-before">{row.before}</span> : null}
                  <span className="agent-review-field-arrow" aria-hidden>
                    →
                  </span>
                  <span className="agent-review-field-after">{row.after}</span>
                </span>
              ) : (
                <span className={cn(fields.mode === "delete" && "agent-review-field-deleted")}>{row.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {fields.note ? <p className="agent-review-item-note muted">{fields.note}</p> : null}
    </div>
  );
}
