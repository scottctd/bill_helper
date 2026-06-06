/**
 * CALLING SPEC:
 * - Purpose: render the `AgentTimeline` React UI module.
 * - Inputs: callers that import `frontend/src/features/agent/panel/AgentTimeline.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `AgentTimeline`.
 * - Side effects: React rendering and user event wiring.
 */
import { Fragment, memo, type Ref } from "react";
import { ArrowDown, File, FileImage, FileText } from "lucide-react";

import type { AgentMessage, AgentMessageAttachment, AgentRun, AgentRunEvent, AgentToolCall } from "../../../lib/types";

/** Persisted message attachments or optimistic preview cards (no `message_id`). */
type AssistantBubbleAttachment =
  | AgentMessageAttachment
  | { id: string; kind: "image" | "pdf"; url: string; name: string };
import { cn } from "../../../lib/utils";
import { AssistantMessageRunWork } from "../AssistantMessageRunWork";
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
import type { PendingAssistantMessage, PendingUserMessage } from "./types";

export interface AgentTimelineProps {
  selectedThreadId: string;
  isLoading: boolean;
  errorMessage: string | null;
  initiatedByExternalAgent: boolean;
  messages: AgentMessage[] | undefined;
  timelineScrollRef: Ref<HTMLDivElement>;
  runsByAssistantMessageId: Map<string, AgentRun[]>;
  pendingAssistantRuns: AgentRun[];
  pendingAssistantRunsByUserMessageId: Map<string, AgentRun[]>;
  pendingUserMessage: PendingUserMessage | null;
  pendingAssistantMessage: PendingAssistantMessage | null;
  shouldShowOptimisticAssistantBubble: boolean;
  pendingRunAttachedToOptimisticMessage: AgentRun | null;
  activeStreamRunId: string | null;
  activeStreamReasoningText: string;
  activeStreamText: string;
  streamedReasoningTextByRunId: Record<string, string>;
  streamedTextByRunId: Record<string, string>;
  optimisticRunEventsByRunId: Record<string, AgentRunEvent[]>;
  optimisticToolCallsByRunId: Record<string, AgentToolCall[]>;
  activeOptimisticEvents: AgentRunEvent[];
  activeOptimisticToolCalls: AgentToolCall[];
  detachFromBottom: () => void;
  onHydrateToolCall: (runId: string, toolCallId: string) => void;
  hydratingToolCallIds: ReadonlySet<string>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

function resolveReasoningSegmentStartedAt(runId: string | null | undefined): number | undefined {
  if (!runId) {
    return undefined;
  }
  return agentStreamSession.reasoningSegmentStartedAtByRunId[runId];
}

function AgentTimelineComponent(props: AgentTimelineProps) {
  const {
    selectedThreadId,
    isLoading,
    errorMessage,
    initiatedByExternalAgent,
    messages,
    timelineScrollRef,
    runsByAssistantMessageId,
    pendingAssistantRuns,
    pendingAssistantRunsByUserMessageId,
    pendingUserMessage,
    pendingAssistantMessage,
    shouldShowOptimisticAssistantBubble,
    pendingRunAttachedToOptimisticMessage,
    activeStreamRunId,
    activeStreamReasoningText,
    activeStreamText,
    streamedReasoningTextByRunId = {},
    streamedTextByRunId = {},
    optimisticRunEventsByRunId = {},
    optimisticToolCallsByRunId = {},
    activeOptimisticEvents = [],
    activeOptimisticToolCalls = [],
    detachFromBottom,
    onHydrateToolCall,
    hydratingToolCallIds,
    isAtBottom,
    scrollToBottom
  } = props;

  function isImageMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase().startsWith("image/");
  }

  function isPdfMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase() === "application/pdf";
  }

  function hasRenderableRunCard(run: AgentRun, optimisticEvents: AgentRunEvent[] = []): boolean {
    return Boolean(run.error_text) || run.events.length > 0 || run.change_items.length > 0 || optimisticEvents.length > 0;
  }

  function renderAssistantAttachments(attachments: AssistantBubbleAttachment[]) {
    if (attachments.length === 0) {
      return null;
    }

    return (
      <div className="agent-message-attachments scroll-surface">
        {attachments.map((attachment) => {
          if ("message_id" in attachment) {
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
    attachments: AgentMessage["attachments"] | PendingUserMessage["attachments"]
  ) {
    if (attachments.length === 0) {
      return null;
    }

    return (
      <div className="agent-message-user-attachments scroll-surface">
        {attachments.map((attachment) => (
          "message_id" in attachment ? (
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
    attachments: AgentMessage["attachments"] | PendingUserMessage["attachments"];
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

  function renderStandaloneRunError(run: AgentRun) {
    if (!run.error_text || run.assistant_message_id) {
      return null;
    }
    return <MarkdownRenderer markdown={formatAgentRunErrorMarkdown(run.error_text)} />;
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
          {(messages ?? []).map((message) => {
            const isAssistant = message.role === "assistant";
            const isUser = message.role === "user";
            const shouldRenderMarkdown = !isUser;
            const renderedContent = message.content_markdown;
            const messageRuns = isAssistant ? runsByAssistantMessageId.get(message.id) ?? [] : [];
            const userMessageRuns = isUser ? pendingAssistantRunsByUserMessageId.get(message.id) ?? [] : [];
            const streamRunForMessage = isAssistant
              ? (activeStreamRunId
                  ? messageRuns.find((run) => run.id === activeStreamRunId)
                  : undefined) ?? messageRuns.find((run) => run.status === "running")
              : undefined;
            const isLiveAssistantStream = Boolean(
              streamRunForMessage && streamRunForMessage.status === "running"
            );
            const liveStreamRunId = streamRunForMessage?.id ?? null;
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
            const streamedAssistantMarkdown =
              isLiveAssistantStream && liveStreamText.length > 0 ? liveStreamText : null;
            const assistantDisplayMarkdown = streamedAssistantMarkdown ?? renderedContent;

            return (
              <Fragment key={message.id}>
                <article
                  className={messageClassName({
                    isAssistant,
                    isUser,
                    isActivity: messageRuns.length > 0
                  })}
                >
                  {isUser ? (
                    renderUserBubble({
                      createdAt: message.created_at,
                      text: renderedContent,
                      emptyText: "(no text)",
                      attachments: message.attachments
                    })
                  ) : (
                    <>
                      {isAssistant && messageRuns.length > 0 ? (
                        <AssistantMessageRunWork
                          runs={messageRuns}
                          optimisticRunEventsByRunId={optimisticRunEventsByRunId}
                          optimisticToolCallsByRunId={optimisticToolCallsByRunId}
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
                        shouldRenderMarkdown ? (
                          <MarkdownRenderer markdown={assistantDisplayMarkdown} />
                        ) : (
                          <p className="agent-message-text">{assistantDisplayMarkdown}</p>
                        )
                      ) : isLiveAssistantStream ? (
                        <p className="agent-message-text agent-message-streaming-text">
                          <span className="agent-message-caret">{"\u258d"}</span>
                        </p>
                      ) : (
                        <p className="muted">(no text)</p>
                      )}

                      {renderAssistantAttachments(message.attachments)}

                      {isAssistant
                        ? messageRuns.map((run) => (
                            <AgentRunBlock
                              key={`${run.id}-summary`}
                              run={run}
                              onInspectActivity={detachFromBottom}
                              onHydrateToolCall={onHydrateToolCall}
                              hydratingToolCallIds={hydratingToolCallIds}
                              mode="summary"
                              optimisticEvents={optimisticRunEventsByRunId[run.id] ?? []}
                              optimisticToolCalls={optimisticToolCallsByRunId[run.id] ?? []}
                            />
                          ))
                        : null}

                      <AgentMessageHeader
                        createdAt={message.created_at}
                        copyText={assistantDisplayMarkdown}
                        className="agent-message-meta-only"
                      />
                    </>
                  )}
                </article>

                {isUser
                  ? userMessageRuns.map((run) => {
                      const optimisticEvents = optimisticRunEventsByRunId[run.id] ?? [];
                      if (!hasRenderableRunCard(run, optimisticEvents)) {
                        return null;
                      }
                      const attachedToOptimisticMessage = pendingRunAttachedToOptimisticMessage && pendingRunAttachedToOptimisticMessage.id === run.id;
                      if (attachedToOptimisticMessage) {
                        return null;
                      }
                      return (
                        <article
                          key={`${run.id}-unattached`}
                          className={messageClassName({
                            isAssistant: true,
                            isActivity: true
                          })}
                        >
                          <AssistantMessageRunWork
                            runs={[run]}
                            optimisticRunEventsByRunId={optimisticRunEventsByRunId}
                            optimisticToolCallsByRunId={optimisticToolCallsByRunId}
                            onInspectActivity={detachFromBottom}
                            onHydrateToolCall={onHydrateToolCall}
                            hydratingToolCallIds={hydratingToolCallIds}
                            streamingReasoningText={resolveRunStreamBuffer(
                              run.id,
                              activeStreamRunId,
                              activeStreamReasoningText,
                              streamedReasoningTextByRunId
                            )}
                            streamingReasoningStartedAt={resolveReasoningSegmentStartedAt(run.id)}
                          />
                          {renderStandaloneRunError(run)}
                          <AgentMessageHeader
                            createdAt={run.created_at}
                            copyText={run.error_text}
                            className="agent-message-meta-only"
                          />
                        </article>
                      );
                    })
                  : null}
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

          {shouldShowOptimisticAssistantBubble && pendingAssistantMessage ? (
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
                  optimisticEvents={activeOptimisticEvents}
                  optimisticToolCalls={activeOptimisticToolCalls}
                  streamingReasoningText={activeStreamReasoningText}
                  streamingReasoningStartedAt={resolveReasoningSegmentStartedAt(activeStreamRunId)}
                />
              ) : activeOptimisticEvents.length > 0 || activeStreamReasoningText.length > 0 || activeStreamText.length > 0 ? (
                <PendingAssistantActivityBlock
                  events={activeOptimisticEvents}
                  toolCalls={activeOptimisticToolCalls}
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
              activeOptimisticEvents.length === 0 &&
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
            const optimisticEvents = optimisticRunEventsByRunId[run.id] ?? [];
            const attachedToOptimisticMessage = pendingRunAttachedToOptimisticMessage && pendingRunAttachedToOptimisticMessage.id === run.id;
            const alreadyAnchoredToUserMessage = Boolean(
              (messages ?? []).some((message) => message.id === run.user_message_id)
            );
            const isLivePendingRun = run.status === "running";
            const pendingRunStreamReasoning = isLivePendingRun
              ? resolveRunStreamBuffer(
                  run.id,
                  activeStreamRunId,
                  activeStreamReasoningText,
                  streamedReasoningTextByRunId
                )
              : "";
            if (attachedToOptimisticMessage) {
              return null;
            }
            if (alreadyAnchoredToUserMessage) {
              return null;
            }
            if (!hasRenderableRunCard(run, optimisticEvents) && !isLivePendingRun && pendingRunStreamReasoning.length === 0) {
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
                  optimisticRunEventsByRunId={optimisticRunEventsByRunId}
                  optimisticToolCallsByRunId={optimisticToolCallsByRunId}
                  onInspectActivity={detachFromBottom}
                  onHydrateToolCall={onHydrateToolCall}
                  hydratingToolCallIds={hydratingToolCallIds}
                  streamingReasoningText={
                    pendingRunStreamReasoning.length > 0 ? pendingRunStreamReasoning : undefined
                  }
                  streamingReasoningStartedAt={resolveReasoningSegmentStartedAt(run.id)}
                />
                {renderStandaloneRunError(run)}
                <AgentMessageHeader
                  createdAt={run.created_at}
                  copyText={run.error_text}
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

AgentTimeline.displayName = "AgentTimeline";
