/**
 * CALLING SPEC:
 * - Purpose: render the read-only proposal review card (header, rationale, structured diff).
 * - Inputs: ReviewItemView fields and optional child slots for domain editors.
 * - Outputs: review card markup using shared agent-review-* styles.
 * - Side effects: none.
 */

import type { ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/utils";
import type { ProposalDiff } from "../agent/review/diff";
import { statusBadgeClass, reviewModeClass } from "./helpers";

export interface ReviewReadOnlyCardProps {
  itemKey: string;
  changeType: string;
  kicker: string;
  title: string;
  status: string;
  runMeta?: string;
  rationale?: string | null;
  diff: ProposalDiff | null;
  extraBadges?: string[];
  children?: ReactNode;
}

export function ReviewReadOnlyCard({
  itemKey,
  changeType,
  kicker,
  title,
  status,
  runMeta,
  rationale,
  diff,
  extraBadges,
  children
}: ReviewReadOnlyCardProps) {
  const diffPreview = diff;

  return (
    <article key={itemKey} className={cn("agent-review-card", reviewModeClass(changeType), "agent-review-card-animated")}>
      <header className="agent-review-card-header">
        <div className="agent-review-card-header-main">
          <div className="agent-review-card-kicker">
            <span>{kicker}</span>
            <Badge variant="outline" className={cn("agent-review-status-badge", statusBadgeClass(status))}>
              {status}
            </Badge>
            {extraBadges?.map((badge) => (
              <Badge key={badge} variant="outline">
                {badge}
              </Badge>
            ))}
          </div>
          <h3>{title}</h3>
          {runMeta ? <p className="agent-review-card-run-meta">{runMeta}</p> : null}
        </div>
      </header>

      <div className="agent-review-card-body">
        <section className="agent-review-panel-section">
          <h4>Rationale</h4>
          <p className="agent-review-rationale">{rationale || "No rationale provided."}</p>
        </section>

        {diffPreview ? (
          <section className="agent-review-panel-section">
            <div className="agent-review-section-heading">
              <h4>{diffPreview.title}</h4>
              <div className="agent-review-item-stats">
                {diffPreview.stats.changed > 0 ? (
                  <Badge variant="outline" className="agent-review-diff-stat is-changed">
                    Changed {diffPreview.stats.changed}
                  </Badge>
                ) : null}
                {diffPreview.stats.added > 0 ? (
                  <Badge variant="outline" className="agent-review-diff-stat is-added">
                    Added {diffPreview.stats.added}
                  </Badge>
                ) : null}
                {diffPreview.stats.removed > 0 ? (
                  <Badge variant="outline" className="agent-review-diff-stat is-removed">
                    Removed {diffPreview.stats.removed}
                  </Badge>
                ) : null}
                {diffPreview.stats.changed === 0 && diffPreview.stats.added === 0 && diffPreview.stats.removed === 0 ? (
                  <Badge variant="outline" className="agent-review-diff-stat">
                    No deltas
                  </Badge>
                ) : null}
              </div>
            </div>
            {diffPreview.metadata.length > 0 ? (
              <div className="agent-review-metadata" role="list" aria-label={`Metadata for ${title}`}>
                {diffPreview.metadata.map((meta) => (
                  <div
                    key={`${itemKey}:${meta.label}:${meta.value}`}
                    className={cn(
                      "agent-review-metadata-pill",
                      meta.tone === "warning" && "is-warning",
                      meta.tone === "danger" && "is-danger"
                    )}
                    role="listitem"
                  >
                    <span className="agent-review-metadata-label">{meta.label}</span>
                    <span className="agent-review-metadata-value">{meta.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="agent-review-diff" role="list" aria-label={`Diff for ${title}`}>
              {diffPreview.lines.length === 0 ? <p className="muted">No changed fields.</p> : null}
              {diffPreview.lines.map((line) => (
                <div
                  key={`${itemKey}:${line.sign}:${line.path}:${line.value}`}
                  className={cn("agent-review-diff-line", line.sign === "+" ? "is-added" : "is-removed")}
                  role="listitem"
                >
                  <span className="agent-review-diff-sign" aria-hidden>
                    {line.sign}
                  </span>
                  <span className="agent-review-diff-path">{line.path}</span>
                  <code className="agent-review-diff-value">{line.value}</code>
                </div>
              ))}
            </div>
            {diffPreview.note ? <p className="agent-review-item-note muted">{diffPreview.note}</p> : null}
          </section>
        ) : null}

        {children}
      </div>
    </article>
  );
}
