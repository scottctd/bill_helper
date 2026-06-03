/**
 * CALLING SPEC:
 * - Purpose: render a TOC section for the shared review panel sidebar.
 * - Inputs: section title, ReviewItemView list, active id, and select handler.
 * - Outputs: sidebar TOC list markup.
 * - Side effects: user selection wiring via onSelect callback.
 */

import { cn } from "../../lib/utils";
import { reviewModeClass, tocStatusIndicator } from "./helpers";
import type { ReviewItemView } from "./types";

export function ReviewTocSection({
  title,
  items,
  activeItemId,
  onSelect
}: {
  title: string;
  items: ReviewItemView[];
  activeItemId: string | null;
  onSelect: (itemId: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="agent-review-toc-section" aria-label={title}>
      <div className="agent-review-toc-section-header">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      <div className="agent-review-toc-list">
        {items.map((item) => {
          const isActive = item.id === activeItemId;
          const statusIndicator = tocStatusIndicator(item.status);
          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                "agent-review-toc-item",
                reviewModeClass(item.changeType),
                isActive && "is-active",
                item.isResolved && "is-resolved"
              )}
              onClick={() => onSelect(item.id)}
            >
              <div className="agent-review-toc-item-copy">
                <span className="agent-review-toc-item-title">{item.title}</span>
                {item.tocMeta ? <span className="agent-review-toc-item-meta">{item.tocMeta}</span> : null}
              </div>
              {statusIndicator ? (
                <span
                  className={cn("agent-review-toc-status-indicator", statusIndicator.className)}
                  aria-label={statusIndicator.label}
                  title={statusIndicator.label}
                >
                  <statusIndicator.icon className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
