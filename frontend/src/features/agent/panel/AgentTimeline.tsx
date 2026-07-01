/**
 * CALLING SPEC:
 * - Purpose: render the `AgentTimeline` React UI module.
 * - Inputs: callers that import `frontend/src/features/agent/panel/AgentTimeline.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `AgentTimeline`.
 * - Side effects: React rendering and user event wiring.
 */
import { Fragment, memo } from "react";
import { ArrowDown, File, FileImage, FileText } from "lucide-react";

import type { AgentRun, AgentRunStep, AgentToolCall, AgentTurn, AgentTurnAttachment } from "../../../lib/types";
import { listOrEmpty } from "../../../lib/collections";
import { cn } from "../../../lib/utils";
import { AssistantMessageRunWork } from "../AssistantMessageRunWork";
import { runErrorText, type RunActivityItem } from "../activity";
import { formatAgentRunErrorMarkdown } from "../formatRunError";
import { AgentRunBlock } from "../AgentRunBlock";
import { PendingAssistantActivityBlock } from "../AgentRunActivity";
import { MarkdownRenderer } from "../../../components/ui/MarkdownRenderer";
import { AgentAttachmentImageCard } from "./AgentAttachmentImageCard";
import { AgentAttachmentPdfCard } from "./AgentAttachmentPdfCard";
import { AgentAttachmentFileRow } from "./AgentAttachmentFileRow";
import { AgentMessageAttachmentRow } from "./AgentMessageAttachmentRow";
import { AgentMessageAttachmentImage } from "./AgentMessageAttachmentImage";
import { AgentMessageAttachmentPdf } from "./AgentMessageAttachmentPdf";
import { AgentMessageHeader } from "./AgentMessageHeader";
import { openAttachmentInNewTab } from "./attachmentBrowserOpen";
import { resolveRunStreamBuffer } from "./helpers";
import { agentStreamSession } from "./agentStreamSession";
import type { AgentTimelineProps } from "./agentTimelineModel";

export type { AgentTimelineModel, AgentTimelineProps } from "./agentTimelineModel";

import type { PendingAssistantMessage, PendingUserMessage } from "./types";

type AssistantBubbleAttachment =
  | AgentTurnAttachment
  | { id: string; kind: "image" | "pdf"; url: string; name: string };

function resolveReasoningSegmentStartedAt(runId: string | null | undefined): number | undefined {
  if (!runId) {
    return undefined;
  }
  return agentStreamSession.reasoningSegmentStartedAtByRunId[runId];
}

function AgentTimelineComponent({ model }: AgentTimelineProps) {
  const {
    selectedThreadId,
    isLoading,
    errorMessage,
    initiatedByExternalAgent,
    turns,
    runsById,
    pendingAssistantRuns,
    pendingUserMessage,
    pendingAssistantMessage,
    shouldShowOptimisticAssistantBubble,
    pendingRunAttachedToOptimisticMessage,
    stream: {
      activeStreamRunId,
      activeStreamReasoningText,
      activeStreamText,
      streamedReasoningTextByRunId = {},
      streamedTextByRunId = {},
      optimisticStepsByRunId = {},
      optimisticToolCallsByRunId = {},
      liveActivityLedgerByRunId = {},
      activeOptimisticSteps = [],
      activeOptimisticToolCalls = [],
      hydratingToolCallIds
    },
    scroll: { timelineScrollRef, detachFromBottom, isAtBottom, scrollToBottom },
    onHydrateToolCall
  } = model;

  function isImageMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase().startsWith("image/");
  }

  function isPdfMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase() === "application/pdf";
  }

  function hasRenderableRunCard(run: AgentRun, optimisticSteps: AgentRunStep[] = []): boolean {
    return (
      Boolean(runErrorText(run)) ||
      listOrEmpty(run.steps).length > 0 ||
      listOrEmpty(run.tool_calls).length > 0 ||
      listOrEmpty(run.change_items).length > 0 ||
      optimisticSteps.length > 0
    );
  }

  function liveActivityItemsForRun(runId: string | null): RunActivityItem[] {
    return runId ? liveActivityLedgerByRunId[runId] ?? [] : [];
  }

  function renderAssistantAttachments(attachments: AssistantBubbleAttachment[]) {
    if (attachments.length === 0) {
      return null;
    }

    return (
      <div className="agent-message-attachments scroll-surface">
        {attachments.map((attachment) => {
          if ("attachment_url" in attachment) {
            if (isImageMimeType(attachment.mime_type)) {
              return (
                <AgentMessageAttachmentImage
                  key={attachment.id}
                  attachmentUrl={attachment.attachment_url}
                  alt={attachment.display_name}
                />
              );
            }
            if (isPdfMimeType(attachment.mime_type)) {
              return (
                <AgentMessageAttachmentPdf
                  key={attachment.id}
                  attachmentUrl={attachment.attachment_url}
                  title={attachment.display_name}
                />
              );
            }
            return (
              <div key={attachment.id} className="agent-message-attachment-file">
                <FileText className="h-4 w-4" />
                <span>{attachment.display_name}</span>
              </div>
            );
          }
          if (attachment.kind === "image") {
            return <AgentAttachmentImageCard key={attachment.id} previewUrl={attachment.url} alt={attachment.name} />;
          }
          if (attachment.kind === "pdf") {
            return <AgentAttachmentPdfCard key={attachment.id} previewUrl={attachment.url} title={attachment.name} />;
          }
          return (
            <div key={attachment.id} className="agent-message-attachment-file">
              <FileText className="h-4 w-4" />
              <span>{attachment.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderUserAttachments(
    attachments: AgentTurnAttachment[] | PendingUserMessage["attachments"]
  ) {
    if (attachments.length === 0) {
      return null;
    }

    return (
      <div className="agent-message-user-attachments scroll-surface">
        {attachments.map((attachment) => (
          "attachment_url" in attachment ? (
            <AgentMessageAttachmentRow
              key={attachment.id}
              attachmentUrl={attachment.attachment_url}
              fileLabel={attachment.display_name}
              mimeType={attachment.mime_type}
            />
          ) : (
            <AgentAttachmentFileRow
              key={attachment.id}
              fileLabel={attachment.name}
              icon={
                attachment.kind === "image"
                  ? FileImage
                  : attachment.kind === "pdf" || attachment.kind === "text"
                    ? FileText
                    : File
              }
              onOpen={() => openAttachmentInNewTab(attachment.url)}
            />
          )
        ))}
      </div>
    );
  }

  function renderUserBubble(options: {
    createdAt: string;
    text: string;
    emptyText: string;
    attachments: AgentTurnAttachment[] | PendingUserMessage["attachments"];
  }) {
    return (
      <>
        <div className="agent-message-user-bubble">
          {renderUserAttachments(options.attachments)}
          {options.text ? (
            <p className="agent-message-text">{options.text}</p>
          ) : (
            <p className="muted">{options.emptyText}</p>
          )}
        </div>
        <AgentMessageHeader
          createdAt={options.createdAt}
          copyText={options.text}
          className="agent-message-user-meta"
        />
      </>
    );
  }

  function renderStandaloneRunError(run: AgentRun | undefined, turn: AgentTurn | undefined) {
    if (!run) {
      return null;
    }
    const errorText = runErrorText(run);
    if (!errorText || turn?.assistant_message?.content_markdown) {
      return null;
    }
    return <MarkdownRenderer markdown={formatAgentRunErrorMarkdown(errorText)} />;
  }

  function messageClassName(options: {
    isAssistant?: boolean;
    isUser?: boolean;
    isActivity?: boolean;
    isStreaming?: boolean;
  }): string {
    return cn(
      "agent-message",
      options.isAssistant && "agent-message-assistant",
      options.isUser && "agent-message-user",
      options.isActivity && "agent-message-activity",
      options.isStreaming && "agent-message-streaming"
    );
  }

  const anchoredRunIds = new Set((turns ?? []).map((turn) => turn.run_id));
  const activeLiveActivityItems = liveActivityItemsForRun(activeStreamRunId);
  const showOptimisticAssistantBubble = Boolean(
    shouldShowOptimisticAssistantBubble &&
      pendingAssistantMessage &&
      !(
        pendingRunAttachedToOptimisticMessage &&
        anchoredRunIds.has(pendingRunAttachedToOptimisticMessage.id)
      )
  );

  return (
    <div className="agent-timeline-pane">
      {!selectedThreadId ? (
        <p className="muted agent-timeline-empty">Select a thread or send a message to start a new one.</p>
      ) : null}
      {isLoading ? <p>Loading timeline...</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}

      {selectedThreadId ? (
        <div className="agent-timeline-scroll-wrapper">
          <div className="agent-timeline-scroll flex flex-col gap-3" ref={timelineScrollRef}>
            {initiatedByExternalAgent ? (
              <aside className="agent-external-session-hint" aria-label="External agent session">
                <p>
                  This session was started by an external agent via <code>bh</code>. Use{" "}
                  <strong>Review</strong> for pending proposals. Chat history from the external agent is not shown
                  here.
                </p>
              </aside>
            ) : null}
            {(turns ?? []).map((turn) => {
              const run = runsById.get(turn.run_id);
              const isLiveAssistantStream = Boolean(
                run && run.status === "running" && (activeStreamRunId === run.id || !turn.assistant_message)
              );
              const liveStreamRunId = isLiveAssistantStream ? run?.id ?? null : null;
              const liveStreamReasoningText = resolveRunStreamBuffer(
                liveStreamRunId,
                activeStreamRunId,
                activeStreamReasoningText,
                streamedReasoningTextByRunId
              );
              const liveStreamText = resolveRunStreamBuffer(
                liveStreamRunId,
                activeStreamRunId,
                activeStreamText,
                streamedTextByRunId
              );
              const persistedAssistantMarkdown = (
                turn.assistant_message?.content_markdown ??
                run?.final_assistant_reply ??
                ""
              ).trim();
              const assistantDisplayMarkdown =
                persistedAssistantMarkdown.length > 0
                  ? persistedAssistantMarkdown
                  : liveStreamText.length > 0
                    ? liveStreamText
                    : "";

              return (
                <Fragment key={turn.run_id}>
                  <article className={messageClassName({ isUser: true })}>
                    {renderUserBubble({
                      createdAt: turn.user_message.created_at,
                      text: turn.user_message.content_markdown,
                      emptyText: "(no text)",
                      attachments: listOrEmpty(turn.user_message.attachments)
                    })}
                  </article>

                  <article
                    className={messageClassName({
                      isAssistant: true,
                      isActivity: Boolean(run && hasRenderableRunCard(run, optimisticStepsByRunId[run.id])),
                      isStreaming: isLiveAssistantStream
                    })}
                  >
                    {run ? (
                      <AssistantMessageRunWork
                        runs={[run]}
                        optimisticStepsByRunId={optimisticStepsByRunId}
                        optimisticToolCallsByRunId={optimisticToolCallsByRunId}
                        liveActivityLedgerByRunId={liveActivityLedgerByRunId}
                        isStreamingRun={isLiveAssistantStream}
                        onInspectActivity={detachFromBottom}
                        onHydrateToolCall={onHydrateToolCall}
                        hydratingToolCallIds={hydratingToolCallIds}
                        streamingReasoningText={isLiveAssistantStream ? liveStreamReasoningText : undefined}
                        streamingReasoningStartedAt={
                          isLiveAssistantStream ? resolveReasoningSegmentStartedAt(liveStreamRunId) : undefined
                        }
                      />
                    ) : null}

                    {assistantDisplayMarkdown.trim() ? (
                      <MarkdownRenderer markdown={assistantDisplayMarkdown} />
                    ) : isLiveAssistantStream ? null : run && !turn.assistant_message ? null : (
                      <p className="muted">(no text)</p>
                    )}

                    {run ? (
                      <AgentRunBlock
                        key={`${run.id}-summary`}
                        run={run}
                        onInspectActivity={detachFromBottom}
                        onHydrateToolCall={onHydrateToolCall}
                        hydratingToolCallIds={hydratingToolCallIds}
                        mode="summary"
                        optimisticSteps={optimisticStepsByRunId[run.id] ?? []}
                        optimisticToolCalls={optimisticToolCallsByRunId[run.id] ?? []}
                      />
                    ) : null}

                    {renderStandaloneRunError(run, turn)}

                    <AgentMessageHeader
                      createdAt={turn.assistant_message?.created_at ?? turn.user_message.created_at}
                      copyText={assistantDisplayMarkdown}
                      className="agent-message-meta-only"
                    />
                  </article>
                </Fragment>
              );
            })}

            {pendingUserMessage && pendingUserMessage.threadId === selectedThreadId ? (
              <article className={messageClassName({ isUser: true })} key={pendingUserMessage.id}>
                {renderUserBubble({
                  createdAt: pendingUserMessage.createdAt,
                  text: pendingUserMessage.content,
                  emptyText: "(attachment-only message)",
                  attachments: pendingUserMessage.attachments
                })}
              </article>
            ) : null}

            {showOptimisticAssistantBubble && pendingAssistantMessage ? (
              <article
                className={messageClassName({
                  isAssistant: true,
                  isActivity: true,
                  isStreaming: true
                })}
                key={pendingAssistantMessage.id}
              >
                {pendingRunAttachedToOptimisticMessage ? (
                  <AgentRunBlock
                    run={pendingRunAttachedToOptimisticMessage}
                    onInspectActivity={detachFromBottom}
                    onHydrateToolCall={onHydrateToolCall}
                    hydratingToolCallIds={hydratingToolCallIds}
                    mode="activity"
                    optimisticSteps={activeOptimisticSteps}
                    optimisticToolCalls={activeOptimisticToolCalls}
                    liveActivityLedgerByRunId={liveActivityLedgerByRunId}
                    streamingReasoningText={activeStreamReasoningText}
                    streamingReasoningStartedAt={resolveReasoningSegmentStartedAt(activeStreamRunId)}
                  />
                ) : activeLiveActivityItems.length > 0 ||
                  activeOptimisticSteps.length > 0 ||
                  activeOptimisticToolCalls.length > 0 ||
                  activeStreamReasoningText.length > 0 ||
                  activeStreamText.length > 0 ? (
                  <PendingAssistantActivityBlock
                    steps={activeOptimisticSteps}
                    toolCalls={activeOptimisticToolCalls}
                    liveActivityItems={activeLiveActivityItems}
                    onInspectActivity={detachFromBottom}
                    onHydrateToolCall={onHydrateToolCall}
                    hydratingToolCallIds={hydratingToolCallIds}
                    streamingReasoningText={activeStreamReasoningText}
                    streamingReasoningStartedAt={resolveReasoningSegmentStartedAt(activeStreamRunId)}
                  />
                ) : null}
                {activeStreamText.length > 0 ? (
                  <MarkdownRenderer markdown={activeStreamText} className="agent-markdown" />
                ) : null}
                {!activeStreamReasoningText.length &&
                !activeStreamText.length &&
                activeLiveActivityItems.length === 0 &&
                activeOptimisticSteps.length === 0 &&
                activeOptimisticToolCalls.length === 0 &&
                !pendingRunAttachedToOptimisticMessage ? (
                  <p className="agent-message-text agent-message-streaming-text">
                    <span className="agent-message-caret">{"\u258d"}</span>
                  </p>
                ) : null}
                <AgentMessageHeader
                  createdAt={pendingAssistantMessage.createdAt}
                  copyText={activeStreamText}
                  className="agent-message-meta-only"
                />
              </article>
            ) : null}

            {pendingAssistantRuns.map((run) => {
              const optimisticSteps = optimisticStepsByRunId[run.id] ?? [];
              const attachedToOptimisticMessage =
                pendingRunAttachedToOptimisticMessage && pendingRunAttachedToOptimisticMessage.id === run.id;
              const alreadyAnchored = anchoredRunIds.has(run.id);
              const isLivePendingRun = run.status === "running";
              const pendingRunStreamReasoning = isLivePendingRun
                ? resolveRunStreamBuffer(
                    run.id,
                    activeStreamRunId,
                    activeStreamReasoningText,
                    streamedReasoningTextByRunId
                  )
                : "";
              if (attachedToOptimisticMessage || alreadyAnchored) {
                return null;
              }
              if (
                !hasRenderableRunCard(run, optimisticSteps) &&
                !isLivePendingRun &&
                pendingRunStreamReasoning.length === 0
              ) {
                return null;
              }
              return (
                <article
                  key={`pending-run-${run.id}`}
                  className={messageClassName({
                    isAssistant: true,
                    isActivity: true,
                    isStreaming: isLivePendingRun
                  })}
                >
                  <AssistantMessageRunWork
                    runs={[run]}
                    optimisticStepsByRunId={optimisticStepsByRunId}
                    optimisticToolCallsByRunId={optimisticToolCallsByRunId}
                    liveActivityLedgerByRunId={liveActivityLedgerByRunId}
                    isStreamingRun={isLivePendingRun}
                    onInspectActivity={detachFromBottom}
                    onHydrateToolCall={onHydrateToolCall}
                    hydratingToolCallIds={hydratingToolCallIds}
                    streamingReasoningText={
                      pendingRunStreamReasoning.length > 0 ? pendingRunStreamReasoning : undefined
                    }
                    streamingReasoningStartedAt={resolveReasoningSegmentStartedAt(run.id)}
                  />
                  {renderStandaloneRunError(run, undefined)}
                  <AgentMessageHeader
                    createdAt={run.created_at}
                    copyText={runErrorText(run)}
                    className="agent-message-meta-only"
                  />
                </article>
              );
            })}
          </div>
          {!isAtBottom ? (
            <button
              type="button"
              className="agent-scroll-to-bottom"
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const AgentTimeline = memo(AgentTimelineComponent);
