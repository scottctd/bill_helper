/**
 * CALLING SPEC:
 * - Purpose: render the shared review detail card header (title and metadata).
 * - Inputs: resource title, key-value metadata rows, and optional source-task link handler.
 * - Outputs: review card header markup.
 * - Side effects: none.
 */

import type { ReviewCardMetadataEntry } from "./types";

export interface ReviewCardHeaderProps {
  title: string;
  metadata: ReviewCardMetadataEntry[];
  onOpenSourceTask?: (taskId: string) => void;
}

function metadataText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function ReviewCardHeader({ title, metadata, onOpenSourceTask }: ReviewCardHeaderProps) {
  const metadataRows = metadata
    .map((entry) => ({
      key: metadataText(entry.key),
      value: metadataText(entry.value),
      links: entry.links ?? []
    }))
    .filter((entry) => entry.key && (entry.value || entry.links.length > 0));

  return (
    <header className="agent-review-card-header">
      <div className="agent-review-card-header-main">
        <h3>{title}</h3>
        {metadataRows.length > 0 ? (
          <dl className="agent-review-card-metadata">
            {metadataRows.map((entry) => (
              <div key={`${entry.key}:${entry.value}`} className="agent-review-card-metadata-row">
                <dt>{entry.key}</dt>
                <dd>
                  {entry.links.length > 0 && onOpenSourceTask ? (
                    <span className="agent-review-metadata-links">
                      {entry.links.map((link, index) => (
                        <span key={link.taskId}>
                          {index > 0 ? <span className="agent-review-metadata-link-sep">, </span> : null}
                          <button
                            type="button"
                            className="agent-review-metadata-link"
                            onClick={() => onOpenSourceTask(link.taskId)}
                          >
                            {link.label}
                          </button>
                        </span>
                      ))}
                    </span>
                  ) : (
                    entry.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  );
}
