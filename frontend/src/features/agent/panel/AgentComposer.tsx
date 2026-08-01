/**
 * CALLING SPEC:
 * - Purpose: render the `AgentComposer` React UI module.
 * - Inputs: callers that import `frontend/src/features/agent/panel/AgentComposer.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `AgentComposer`.
 * - Side effects: React rendering and user event wiring.
 */
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { CircleHelp, FileImage, FileText, LoaderCircle, Paperclip, SendHorizontal, Square, X } from "lucide-react";

import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { SingleSelect, type SingleSelectOption } from "../../../components/SingleSelect";
import { Textarea } from "../../../components/ui/textarea";
import { Tooltip } from "../../../components/ui/tooltip";
import type { AgentApprovalPolicy } from "../../../lib/types";
import { resolveAgentModelOptionLabel } from "./helpers";
import type { DraftAttachment } from "./types";

interface AgentComposerProps {
  isComposerDragActive: boolean;
  draftAttachments: DraftAttachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  draftMessage: string;
  availableModels: string[];
  modelDisplayNames: Record<string, string>;
  selectedModel: string;
  isModelPickerDisabled: boolean;
  isMutating: boolean;
  isRunInFlight: boolean;
  isSendingMessage: boolean;
  isInterruptPending: boolean;
  actionError: string | null;
  approvalPolicy: AgentApprovalPolicy;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDragEnter: (event: DragEvent<HTMLFormElement>) => void;
  onDragOver: (event: DragEvent<HTMLFormElement>) => void;
  onDragLeave: (event: DragEvent<HTMLFormElement>) => void;
  onDrop: (event: DragEvent<HTMLFormElement>) => void;
  onMessageChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onModelChange: (value: string) => void;
  onApprovalPolicyChange: (value: string) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onStopRun: () => void;
}

export function AgentComposer(props: AgentComposerProps) {
  const {
    isComposerDragActive,
    draftAttachments,
    onRemoveAttachment,
    composerTextareaRef,
    fileInputRef,
    draftMessage,
    availableModels,
    modelDisplayNames,
    selectedModel,
    isModelPickerDisabled,
    isMutating,
    isRunInFlight,
    isSendingMessage,
    isInterruptPending,
    actionError,
    approvalPolicy,
    onSubmit,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onMessageChange,
    onModelChange,
    onApprovalPolicyChange,
    onComposerKeyDown,
    onComposerPaste,
    onFileSelection,
    onStopRun
  } = props;
  const showStopButton = isRunInFlight;
  const submitLabel = isSendingMessage ? "Sending..." : "Send";
  const composerPlaceholder = "Ask a question or ask the agent to propose entries/tags/entities...";
  const modelOptions: SingleSelectOption[] =
    availableModels.length === 0
      ? [{ value: "", label: "Loading models…" }]
      : availableModels.map((modelName) => ({
          value: modelName,
          label: resolveAgentModelOptionLabel(modelName, modelDisplayNames)
        }));
  const policyOptions: SingleSelectOption[] = [
    { value: "default", label: "Default" },
    { value: "yolo", label: "Yolo" }
  ];

  function attachmentStatusLabel(attachment: DraftAttachment): string | null {
    if (attachment.phase === "uploading") {
      return `${attachment.uploadProgress}%`;
    }
    if (attachment.phase === "processing") {
      return attachment.kind === "pdf" ? "Preparing pages…" : "Saving…";
    }
    if (attachment.phase === "ready") {
      return "Ready";
    }
    if (attachment.phase === "failed") {
      return attachment.errorMessage || "Upload failed.";
    }
    return null;
  }

  return (
    <form
      className={cn("agent-composer", isComposerDragActive && "agent-composer-drop-active")}
      onSubmit={onSubmit}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isComposerDragActive ? <p className="muted">Drop images or PDFs to attach</p> : null}
      {draftAttachments.length > 0 ? (
        <div className="agent-draft-attachments scroll-surface" aria-label="Pending attachments">
          {draftAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className={cn(
                "agent-draft-attachment-card",
                attachment.phase === "failed" && "agent-draft-attachment-card-failed"
              )}
            >
              <div className="agent-draft-attachment-card-top">
                <div className="agent-draft-attachment-file" title={attachment.file.name}>
                  {attachment.kind === "image" ? <FileImage className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  <span className="agent-draft-attachment-file-name">{attachment.file.name}</span>
                </div>
                <span className="agent-draft-attachment-inline-status">
                  {attachment.phase === "processing" ? (
                    <span className="agent-draft-attachment-inline-label agent-draft-attachment-status-live">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      {attachmentStatusLabel(attachment)}
                    </span>
                  ) : attachment.phase === "failed" ? (
                    <span className="agent-draft-attachment-inline-label agent-draft-attachment-inline-label-error">
                      {attachmentStatusLabel(attachment)}
                    </span>
                  ) : null}
                  {attachment.phase === "uploading" || attachment.phase === "ready" ? (
                    <span className="agent-draft-attachment-inline-label">{attachmentStatusLabel(attachment)}</span>
                  ) : null}
                  <span className="agent-draft-attachment-progress" aria-hidden="true">
                    <span
                      className={cn(
                        "agent-draft-attachment-progress-bar",
                        attachment.phase === "processing" && "is-processing",
                        attachment.phase === "ready" && "is-ready",
                        attachment.phase === "failed" && "is-failed"
                      )}
                      style={
                        attachment.phase === "uploading"
                          ? { width: `${Math.max(6, attachment.uploadProgress)}%` }
                          : attachment.phase === "ready"
                            ? { width: "100%" }
                            : undefined
                      }
                    />
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="agent-draft-attachment-remove"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.file.name}`}
                  disabled={isSendingMessage}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="agent-composer-box">
        <Textarea
          ref={composerTextareaRef}
          className="agent-composer-textarea border-none shadow-none focus-visible:ring-0"
          placeholder={composerPlaceholder}
          value={draftMessage}
          onChange={onMessageChange}
          onKeyDown={onComposerKeyDown}
          onPaste={onComposerPaste}
          rows={1}
        />

        <div className="agent-composer-toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf,text/*,.csv,.tsv,.txt,.md,.json,.yaml,.yml,.log,.xml"
            multiple
            onChange={onFileSelection}
            className="sr-only"
            tabIndex={-1}
          />
          <div className="agent-composer-secondary-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="agent-composer-attach"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Add attachments"
            >
              <Paperclip className="h-4 w-4 shrink-0" />
              <span className="agent-composer-attach-text">Attach</span>
            </Button>
          </div>

          <div className="agent-composer-primary-actions">
            <div className="agent-composer-select agent-composer-model-select">
              <SingleSelect
                options={modelOptions}
                value={availableModels.length === 0 ? "" : selectedModel}
                onChange={onModelChange}
                ariaLabel="Agent model"
                disabled={isModelPickerDisabled || availableModels.length === 0}
              />
            </div>
            <div className="agent-composer-policy-wrap">
              <div className="agent-composer-policy">
                <span className="agent-composer-policy-label">Policy</span>
                <div className="agent-composer-select agent-composer-policy-select">
                  <SingleSelect
                    options={policyOptions}
                    value={approvalPolicy}
                    onChange={onApprovalPolicyChange}
                    ariaLabel="Approval policy"
                    disabled={isMutating || isSendingMessage || isInterruptPending}
                  />
                </div>
              </div>
              <Tooltip content="Default: review proposals before they apply. Yolo: auto-apply this run’s proposals after it completes successfully.">
                <button type="button" className="agent-composer-policy-help" aria-label="Approval policy help">
                  <CircleHelp className="h-3 w-3 text-muted-foreground/80" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>

            {showStopButton ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isInterruptPending}
                className="agent-composer-send"
                onClick={onStopRun}
              >
                {isInterruptPending ? "Stopping..." : "Stop"}
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={isMutating} className="agent-composer-send">
                {submitLabel}
                <SendHorizontal className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {actionError ? <p className="error">{actionError}</p> : null}
    </form>
  );
}
