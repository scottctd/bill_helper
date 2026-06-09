/**
 * CALLING SPEC:
 * - Purpose: provide the `types` frontend module.
 * - Inputs: callers that import `frontend/src/features/agent/panel/types.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `types`.
 * - Side effects: module-local frontend behavior only.
 */
export type DraftAttachmentKind = "image" | "pdf" | "text";

export type DraftAttachmentPhase = "uploading" | "processing" | "ready" | "failed";

export interface DraftAttachment {
  id: string;
  file: File;
  kind: DraftAttachmentKind;
  localObjectUrl: string;
  uploadedAttachmentId: string | null;
  uploadProgress: number;
  phase: DraftAttachmentPhase;
  errorMessage: string | null;
}

export interface ReadyDraftAttachment {
  id: string;
  file: File;
  kind: DraftAttachmentKind;
  localObjectUrl: string;
  uploadedAttachmentId: string;
}

export interface PendingUserAttachmentPreview {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  kind: DraftAttachmentKind;
}

export interface PendingUserMessage {
  id: string;
  threadId: string;
  content: string;
  createdAt: string;
  baselineLastTurnRunId: string | null;
  attachments: PendingUserAttachmentPreview[];
}

export interface PendingAssistantMessage {
  id: string;
  threadId: string;
  createdAt: string;
  baselineLastTurnRunId: string | null;
}

export const IMAGE_FILENAME_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;
export const PDF_FILENAME_PATTERN = /\.pdf$/i;
export const TEXT_FILENAME_PATTERN = /\.(csv|json|log|md|tsv|txt|xml|ya?ml)$/i;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 220;

interface AttachmentFileLike {
  name: string;
  type?: string;
}

export function isImageAttachment(file: AttachmentFileLike): boolean {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) {
    return true;
  }
  return IMAGE_FILENAME_PATTERN.test(file.name.toLowerCase());
}

export function isPdfAttachment(file: AttachmentFileLike): boolean {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType === "application/pdf") {
    return true;
  }
  return PDF_FILENAME_PATTERN.test(file.name.toLowerCase());
}

export function isTextAttachment(file: AttachmentFileLike): boolean {
  const mimeType = (file.type || "").toLowerCase();
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/csv"
  ) {
    return true;
  }
  return TEXT_FILENAME_PATTERN.test(file.name.toLowerCase());
}

export function isSupportedAgentAttachment(file: AttachmentFileLike): boolean {
  return isImageAttachment(file) || isPdfAttachment(file) || isTextAttachment(file);
}

export function detectDraftAttachmentKind(file: AttachmentFileLike): DraftAttachmentKind {
  if (isPdfAttachment(file)) {
    return "pdf";
  }
  if (isTextAttachment(file)) {
    return "text";
  }
  return "image";
}
