/**
 * CALLING SPEC:
 * - Purpose: render the hierarchical review sidebar TOC.
 * - Inputs: ReviewItemView list, active id, and select handler.
 * - Outputs: status → proposal-type → entry-destination tree markup.
 * - Side effects: user selection wiring via onSelect callback.
 */

import { cn } from "../../lib/utils";
import { reviewModeClass, tocStatusIndicator } from "./helpers";
import { buildReviewTocTree } from "./tocTree";
import type { ReviewItemView } from "./types";

function ReviewTocMeta({ meta }: { meta: string }) {
  const match = meta.match(/^(?:(\d{4}-\d{2}-\d{2}) )?([+\-~]) (.+)$/);
  if (!match) {
    return <span className="agent-review-toc-item-meta">{meta}</span>;
  }

  const [, datePart, sign, amountPart] = match;
  const signClass =
    sign === "+" ? "is-income" : sign === "-" ? "is-expense" : "is-transfer";

  return (
    <span className="agent-review-toc-item-meta">
      {datePart ? `${datePart} ` : null}
      <span className={cn("agent-review-toc-item-kind-sign", signClass)}>{sign}</span> {amountPart}
    </span>
  );
}

function ReviewTocLeaf({
  item,
  activeItemId,
  onSelect
}: {
  item: ReviewItemView;
  activeItemId: string | null;
  onSelect: (itemId: string) => void;
}) {
  const isActive = item.id === activeItemId;
  const statusIndicator = tocStatusIndicator(item.status);
  const leafTitle = item.tocTitle ?? item.title;

  return (
    <button
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
        <span className="agent-review-toc-item-title">{leafTitle}</span>
        {item.tocMeta ? <ReviewTocMeta meta={item.tocMeta} /> : null}
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
}

function ReviewTocItemList({
  items,
  activeItemId,
  onSelect,
  className
}: {
  items: ReviewItemView[];
  activeItemId: string | null;
  onSelect: (itemId: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("agent-review-toc-list", className)}>
      {items.map((item) => (
        <ReviewTocLeaf key={item.id} item={item} activeItemId={activeItemId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function ReviewToc({
  items,
  activeItemId,
  onSelect
}: {
  items: ReviewItemView[];
  activeItemId: string | null;
  onSelect: (itemId: string) => void;
}) {
  const sections = buildReviewTocTree(items);
  if (sections.length === 0) {
    return null;
  }

  return (
    <nav className="agent-review-toc-tree" aria-label="Proposal review">
      {sections.map((section) => (
        <section key={section.key} className="agent-review-toc-section" aria-label={section.label}>
          <div className="agent-review-toc-section-header">
            <h3>{section.label}</h3>
            <span>{section.count}</span>
          </div>

          {section.typeGroups.map((typeGroup) => (
            <div key={typeGroup.key} className="agent-review-toc-type-group">
              <div className="agent-review-toc-type-header">
                <h4>{typeGroup.label}</h4>
                <span>{typeGroup.count}</span>
              </div>

              {typeGroup.destinationGroups ? (
                typeGroup.destinationGroups.map((destinationGroup) => (
                  <div key={destinationGroup.key} className="agent-review-toc-destination-group">
                    <div className="agent-review-toc-destination-header">
                      <h5>{destinationGroup.label}</h5>
                      <span>{destinationGroup.count}</span>
                    </div>
                    <ReviewTocItemList
                      items={destinationGroup.items}
                      activeItemId={activeItemId}
                      onSelect={onSelect}
                      className="agent-review-toc-list-nested"
                    />
                  </div>
                ))
              ) : (
                <ReviewTocItemList items={typeGroup.items} activeItemId={activeItemId} onSelect={onSelect} />
              )}
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}
