/**
 * CALLING SPEC:
 * - Purpose: normalized view model for the shared proposal review panel.
 * - Inputs: mappers from import aggregated proposals (and future review sources).
 * - Outputs: ReviewItemView display contract.
 * - Side effects: none.
 */

import type { ProposalDiff } from "../agent/review/diff";

export interface ReviewItemView {
  id: string;
  changeType: string;
  title: string;
  kicker: string;
  status: string;
  meta?: string;
  rationale?: string | null;
  diff: ProposalDiff | null;
  isPending: boolean;
  isResolved: boolean;
  tocMeta?: string;
  extraBadges?: string[];
}
