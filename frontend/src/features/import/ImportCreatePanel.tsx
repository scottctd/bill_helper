/**
 * CALLING SPEC:
 * - Purpose: create-job panel with attachment upload, re-import chooser, and launch controls.
 * - Inputs: runtime settings, mutation callbacks, and navigation after job creation.
 * - Outputs: import create form UI.
 * - Side effects: draft attachment uploads and preflight API calls.
 */

import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, FileUp, History, RotateCcw, Settings2, SkipForward, Upload } from "lucide-react";

import { WorkspaceSection } from "../../components/layout/WorkspaceSection";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { useAgentDraftAttachments } from "../agent/panel/useAgentDraftAttachments";
import { resolveAgentModelOptionLabel } from "../agent/panel/helpers";
import { createImportJob, getRuntimeSettings, preflightImportSources } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { ImportPreflightFile, ImportPreflightSuggestedAction, ImportPriorImport } from "../../lib/types";
import { cn } from "../../lib/utils";
import { formatImportTimestamp, importTaskStatusLabel } from "./importHelpers";
import type { ImportTaskConversationTarget } from "./ImportTaskDialog";

type FileDecision = {
  attachmentId: string;
  filename: string;
  sizeBytes: number;
  preflight: ImportPreflightFile | null;
  action: ImportPreflightSuggestedAction;
};

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface ImportCreatePanelProps {
  onJobCreated: (jobId: string) => void;
  onOpenPriorImport?: (target: ImportTaskConversationTarget) => void;
}

function priorImportLabel(prior: ImportPriorImport): string {
  const applied = prior.applied_count === 1 ? "1 applied change" : `${prior.applied_count} applied changes`;
  return `${importTaskStatusLabel(prior.task_status)} · ${applied}`;
}

export function ImportCreatePanel({ onJobCreated, onOpenPriorImport }: ImportCreatePanelProps) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("Import entries from each attached source file.");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedConcurrency, setSelectedConcurrency] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<string, FileDecision>>({});
  const [readyAttachmentIds, setReadyAttachmentIds] = useState<string[]>([]);

  const runtimeQuery = useQuery({
    queryKey: queryKeys.settings.runtime,
    queryFn: getRuntimeSettings
  });

  const availableModels = runtimeQuery.data?.available_agent_models ?? [];
  const modelDisplayNames = runtimeQuery.data?.agent_model_display_names ?? {};
  const resolvedModel =
    selectedModel && availableModels.includes(selectedModel)
      ? selectedModel
      : runtimeQuery.data?.agent_model ?? availableModels[0] ?? "";

  useEffect(() => {
    if (!selectedModel && runtimeQuery.data?.agent_model) {
      setSelectedModel(runtimeQuery.data.agent_model);
    }
  }, [runtimeQuery.data?.agent_model, selectedModel]);

  useEffect(() => {
    if (selectedConcurrency == null && runtimeQuery.data?.agent_bulk_max_concurrent_threads) {
      setSelectedConcurrency(runtimeQuery.data.agent_bulk_max_concurrent_threads);
    }
  }, [runtimeQuery.data?.agent_bulk_max_concurrent_threads, selectedConcurrency]);

  const attachments = useAgentDraftAttachments({ setActionError });

  useEffect(() => {
    let cancelled = false;
    async function syncReadyAttachments() {
      const ready = attachments.draftAttachments.filter((item) => item.phase === "ready" && item.uploadedAttachmentId);
      const ids = ready.map((item) => item.uploadedAttachmentId as string);
      setReadyAttachmentIds(ids);
      if (ids.length === 0) {
        setDecisions({});
        return;
      }
      try {
        const preflight = await preflightImportSources(ids);
        if (cancelled) {
          return;
        }
        const next: Record<string, FileDecision> = {};
        for (const file of preflight.files) {
          next[file.attachment_id] = {
            attachmentId: file.attachment_id,
            filename: file.filename,
            sizeBytes: file.size_bytes,
            preflight: file,
            action: file.suggested_action
          };
        }
        setDecisions(next);
      } catch (error) {
        if (!cancelled) {
          setActionError((error as Error).message);
        }
      }
    }
    void syncReadyAttachments();
    return () => {
      cancelled = true;
    };
  }, [attachments.draftAttachments]);

  const selectedCount = useMemo(
    () => Object.values(decisions).filter((item) => item.action === "import").length,
    [decisions]
  );
  const previouslyImportedCount = useMemo(
    () => Object.values(decisions).filter((item) => item.preflight?.previously_imported).length,
    [decisions]
  );
  const readyCount = Object.keys(decisions).length;
  const newCount = Math.max(readyCount - previouslyImportedCount, 0);

  const createMutation = useMutation({
    mutationFn: createImportJob,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.import.jobs });
      attachments.setDraftAttachments([]);
      setDecisions({});
      onJobCreated(job.id);
    },
    onError: (error: Error) => setActionError(error.message)
  });

  function setActionForAll(action: ImportPreflightSuggestedAction) {
    setDecisions((current) =>
      Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, action }]))
    );
  }

  function skipPreviouslyImported() {
    setDecisions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          {
            ...value,
            action: value.preflight?.previously_imported ? "skip" : value.action
          }
        ])
      )
    );
  }

  function resetToSuggested() {
    setDecisions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          {
            ...value,
            action: value.preflight?.suggested_action ?? "import"
          }
        ])
      )
    );
  }

  async function handleStartImport() {
    setActionError(null);
    const importIds = Object.values(decisions)
      .filter((item) => item.action === "import")
      .map((item) => item.attachmentId);
    if (importIds.length === 0) {
      setActionError("Select at least one file to import.");
      return;
    }
    await createMutation.mutateAsync({
      instructions,
      source_attachment_ids: importIds,
      model_name: resolvedModel || undefined,
      concurrency: selectedConcurrency ?? runtimeQuery.data?.agent_bulk_max_concurrent_threads ?? 4
    });
  }

  const isPreflightPending =
    attachments.draftAttachments.some((item) => item.phase === "uploading" || item.phase === "processing") ||
    (readyAttachmentIds.length > 0 && Object.keys(decisions).length === 0);

  return (
    <WorkspaceSection
      className="import-create-section"
      title="New import"
      description="Upload source files, choose what should run, then start parallel agent conversations."
      contentClassName="import-create-section-body"
    >
      <div className="import-create-steps" aria-label="Import workflow">
        <div className="import-create-step is-active">
          <span className="import-create-step-index">1</span>
          <span>Attach files</span>
        </div>
        <div className={cn("import-create-step", readyCount > 0 && "is-active")}>
          <span className="import-create-step-index">2</span>
          <span>Resolve re-imports</span>
        </div>
        <div className={cn("import-create-step", selectedCount > 0 && "is-active")}>
          <span className="import-create-step-index">3</span>
          <span>Launch workers</span>
        </div>
      </div>

      <div className="import-launch-grid">
        <div className="import-source-column">
          <div
            className={cn("import-dropzone", attachments.isComposerDragActive && "is-active")}
            onDragEnter={(event) => attachments.handlers.handleComposerDragEnter(event as unknown as ReactDragEvent<HTMLFormElement>)}
            onDragOver={(event) => attachments.handlers.handleComposerDragOver(event as unknown as ReactDragEvent<HTMLFormElement>)}
            onDragLeave={(event) => attachments.handlers.handleComposerDragLeave(event as unknown as ReactDragEvent<HTMLFormElement>)}
            onDrop={(event) => attachments.handlers.handleComposerDrop(event as unknown as ReactDragEvent<HTMLFormElement>)}
          >
            <input
              ref={attachments.fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={attachments.handlers.handleDraftFileSelection}
            />
            <span className="import-dropzone-icon-wrap">
              <FileUp className="import-dropzone-icon" aria-hidden="true" />
            </span>
            <div className="import-dropzone-copy">
              <p className="import-dropzone-title">Drop source files</p>
              <p className="import-dropzone-subtitle">Each file becomes one queued task with its own replayable conversation.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => attachments.fileInputRef.current?.click()}>
              Choose files
            </Button>
          </div>

          {attachments.draftAttachments.length > 0 ? (
            <div className="import-file-chooser">
              <div className="import-file-summary-bar">
                <span>
                  {attachments.draftAttachments.length} file{attachments.draftAttachments.length === 1 ? "" : "s"} · {newCount} new ·{" "}
                  {selectedCount} importing
                  {previouslyImportedCount > 0 ? ` · ${previouslyImportedCount} previously imported` : ""}
                </span>
                <div className="import-file-summary-actions">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setActionForAll("import")}>
                    <Upload className="h-3.5 w-3.5" />
                    Import all
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={skipPreviouslyImported}>
                    <SkipForward className="h-3.5 w-3.5" />
                    Skip previous
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={resetToSuggested}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </div>
              </div>

              <ul className="import-file-list">
                {attachments.draftAttachments.map((attachment) => {
                  const uploadedId = attachment.uploadedAttachmentId;
                  const decision = uploadedId ? decisions[uploadedId] : null;
                  const isSkipped = decision?.action === "skip";
                  const badge = decision?.preflight?.previously_imported ? "Imported before" : "New";
                  const firstPrior = decision?.preflight?.prior_imports[0] ?? null;
                  return (
                    <li key={attachment.id} className={cn("import-file-row", isSkipped && "is-skipped")}>
                      <div className="import-file-row-main">
                        <div className="import-file-leading">
                          <span className={cn("import-file-icon", decision?.preflight?.previously_imported && "is-history")}>
                            {decision?.preflight?.previously_imported ? (
                              <History className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <FileText className="h-4 w-4" aria-hidden="true" />
                            )}
                          </span>
                          <div>
                            <p className="import-file-name">{attachment.file.name}</p>
                            <p className="import-file-meta muted text-sm">
                              {formatBytes(attachment.file.size)}
                              {decision?.preflight ? ` · ${badge}` : attachment.phase !== "ready" ? ` · ${attachment.phase}` : ""}
                            </p>
                            {firstPrior ? (
                              <div className="import-file-prior">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>
                                  {formatImportTimestamp(firstPrior.imported_at)} · {priorImportLabel(firstPrior)}
                                </span>
                                {onOpenPriorImport ? (
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    onClick={() =>
                                      onOpenPriorImport({
                                        thread_id: firstPrior.thread_id,
                                        source_label: `${attachment.file.name} previous run`
                                      })
                                    }
                                  >
                                    View previous run
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {decision ? (
                          <div
                            className="import-segmented-control"
                            role="group"
                            aria-label={`Import decision for ${attachment.file.name}`}
                          >
                            <button
                              type="button"
                              className={cn("import-segment", decision.action === "import" && "is-active")}
                              onClick={() =>
                                uploadedId &&
                                setDecisions((current) => ({
                                  ...current,
                                  [uploadedId]: { ...decision, action: "import" }
                                }))
                              }
                            >
                              Import
                            </button>
                            <button
                              type="button"
                              className={cn("import-segment", decision.action === "skip" && "is-active")}
                              onClick={() =>
                                uploadedId &&
                                setDecisions((current) => ({
                                  ...current,
                                  [uploadedId]: { ...decision, action: "skip" }
                                }))
                              }
                            >
                              Skip
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="import-config-panel" aria-label="Import launch settings">
          <div className="import-config-panel-header">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            <span>Launch settings</span>
          </div>
          <div className="import-config-fields">
            <label className="import-field">
              <span className="import-field-label">Agent model</span>
              <select
                className="import-model-select"
                aria-label="Import agent model"
                value={resolvedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={availableModels.length === 0}
              >
                {availableModels.length === 0 ? <option value="">Loading models…</option> : null}
                {availableModels.map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {resolveAgentModelOptionLabel(modelName, modelDisplayNames)}
                  </option>
                ))}
              </select>
            </label>
            <label className="import-field import-worker-field">
              <span className="import-field-label">Workers</span>
              <input
                className="import-worker-input"
                type="number"
                min={1}
                max={16}
                value={selectedConcurrency ?? runtimeQuery.data?.agent_bulk_max_concurrent_threads ?? 4}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSelectedConcurrency(Number.isFinite(next) ? Math.min(Math.max(next, 1), 16) : 1);
                }}
                aria-label="Import worker count"
              />
            </label>
          </div>

          <label className="import-instructions-label">
            Shared instructions
            <Textarea
              className="import-instructions-textarea"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={5}
            />
          </label>

          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

          <div className="import-create-actions">
            <Button
              type="button"
              className="import-start-button"
              onClick={() => void handleStartImport()}
              disabled={createMutation.isPending || isPreflightPending || selectedCount === 0}
            >
              {createMutation.isPending ? "Starting…" : `Start import (${selectedCount} file${selectedCount === 1 ? "" : "s"})`}
            </Button>
          </div>
        </aside>
      </div>
    </WorkspaceSection>
  );
}
