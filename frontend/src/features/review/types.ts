/**
 * CALLING SPEC:
 * - Purpose: normalized view model for the shared proposal review panel.
 * - Inputs: mappers from import aggregated proposals (and future review sources).
 * - Outputs: ReviewItemView display contract.
 * - Side effects: none.
 */

import type { ProposalFields } from "./proposalFields";

export interface ReviewCardMetadataLink {
  taskId: string;
  label: string;
}

export interface ReviewCardMetadataEntry {
  key: string;
  value: string;
  links?: ReviewCardMetadataLink[];
}

export type ReviewSummaryPartTone = "plain" | "highlight";

export interface ReviewSummaryPart {
  text: string;
  tone: ReviewSummaryPartTone;
}

export type ReviewContextTone = "neutral" | "warning" | "danger";

export interface ReviewContextLine {
  text: string;
  tone?: ReviewContextTone;
}

export type ReviewOutcomeValueKind = "text" | "code";

export interface ReviewOutcomeLine {
  label: string;
  value: string;
  kind?: ReviewOutcomeValueKind;
}

export interface ReviewItemView {
  id: string;
  changeType: string;
  title: string;
  kicker: string;
  status: string;
  cardMetadata?: ReviewCardMetadataEntry[];
  summary?: ReviewSummaryPart[];
  context?: ReviewContextLine[];
  outcome?: ReviewOutcomeLine[];
  fields: ProposalFields | null;
  isPending: boolean;
  isResolved: boolean;
  tocTitle?: string;
  tocMeta?: string;
  entryName?: string;
  entryToEntity?: string;
}
