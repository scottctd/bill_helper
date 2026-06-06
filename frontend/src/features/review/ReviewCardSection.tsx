/**
 * CALLING SPEC:
 * - Purpose: render a titled section inside a proposal review card body.
 * - Inputs: optional section title and child content.
 * - Outputs: section markup with shared agent-review-panel-section styles.
 * - Side effects: none.
 */

import type { ReactNode } from "react";

export interface ReviewCardSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
}

export function ReviewCardSection({ title, description, children }: ReviewCardSectionProps) {
  return (
    <section className="agent-review-panel-section">
      {title || description ? (
        <div className="agent-review-section-heading">
          {title ? <h4>{title}</h4> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
