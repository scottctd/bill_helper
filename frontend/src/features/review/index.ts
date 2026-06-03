/**
 * CALLING SPEC:
 * - Purpose: public exports for the shared proposal review panel module.
 * - Inputs: feature consumers (agent review modal, import job review).
 * - Outputs: panel shell, read-only card, TOC section, mappers, and view types.
 * - Side effects: none.
 */

export { ReviewPanel, type ReviewPanelProps } from "./ReviewPanel";
export { ReviewReadOnlyCard, type ReviewReadOnlyCardProps } from "./ReviewReadOnlyCard";
export { ReviewTocSection } from "./ReviewTocSection";
export { findRelativeReviewItemId, isPendingReviewStatus, reviewModeClass, statusBadgeClass, tocStatusIndicator } from "./helpers";
export { mapImportProposalToReviewItem, mapImportProposalsToReviewItems } from "./mapImportProposal";
export type { ReviewItemView } from "./types";
