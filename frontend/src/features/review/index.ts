/**
 * CALLING SPEC:
 * - Purpose: public exports for the shared proposal review panel module.
 * - Inputs: feature consumers (agent review modal, import job review).
 * - Outputs: panel shell, read-only card, TOC section, mappers, and view types.
 * - Side effects: none.
 */

export { ReviewPanel, type ReviewPanelProps } from "./ReviewPanel";
export { buildReviewCardMetadata } from "./cardMetadata";
export { ReviewCardHeader, type ReviewCardHeaderProps } from "./ReviewCardHeader";
export { ReviewItemCard, type ReviewItemCardProps } from "./ReviewItemCard";
export { ReviewCardSection, type ReviewCardSectionProps } from "./ReviewCardSection";
export { ReviewSummary, type ReviewSummaryProps } from "./ReviewSummary";
export { ReviewContextList, type ReviewContextListProps } from "./ReviewContextList";
export { ReviewOutcomeList, type ReviewOutcomeListProps } from "./ReviewOutcomeList";
export { buildProposalSummary, reviewSummaryText } from "./proposalSummary";
export { buildProposalContext, type BuildProposalContextOptions, type ProposalContextSiblingItem } from "./proposalContext";
export { buildProposalOutcome, type BuildProposalOutcomeInput } from "./proposalOutcome";
export { ReviewFieldList, type ReviewFieldListProps } from "./ReviewFieldList";
export { buildProposalFields, type ProposalFieldRow, type ProposalFieldMode, type ProposalFields } from "./proposalFields";
export { humanizeFieldLabel, humanizeFieldValue, humanizeProposalFields } from "./fieldDisplay";
export { ReviewToc } from "./ReviewToc";
export {
  findRelativeReviewItemId,
  groupReviewItemsByChangeType,
  isPendingReviewStatus,
  reviewModeClass,
  statusBadgeClass,
  tocStatusIndicator,
  type TocProposalGroup
} from "./helpers";
export { buildReviewTocTree, type ReviewTocStatusSection } from "./tocTree";
export { extractEntryTocFields } from "./entryTocFields";
export { buildTocLeafMeta, buildTocLeafTitle } from "./tocDisplay";
export { mapImportProposalToReviewItem, mapImportProposalsToReviewItems } from "./mapImportProposal";
export { mapThreadReviewItemToReviewItemView, mapThreadReviewItemsToReviewItems } from "./mapThreadReviewItem";
export type { ReviewCardMetadataEntry, ReviewItemView } from "./types";
