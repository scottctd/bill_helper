/**
 * CALLING SPEC:
 * - Purpose: render flat agent run activity rows (collapsible model reasoning, tool calls expandable).
 * - Inputs: callers that import `frontend/src/features/agent/AgentRunActivity.tsx`.
 * - Outputs: `AgentRunActivityRows`, `PendingAssistantActivityBlock`.
 * - Side effects: React rendering and tool hydration requests.
 */
import { useEffect, useMemo, useState } from "react";

import type { AgentRunStep, AgentToolCall } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  buildLiveRunTimelineFromToolCalls,
  buildRunTimelineFromProjections,
  isToolStatusTerminal,
  toolStatusClass,
  toolStatusLabel,
  type RunActivityItem
} from "./activity";
import { MarkdownRenderer } from "../../components/ui/MarkdownRenderer";
import {
  estimateReasoningTokenCount,
  formatThinkingSummaryLabel,
  formatThoughtSummaryLabel,
  STREAMING_REASONING_TAIL_LINE_COUNT,
  tailReasoningLines
} from "./reasoning_segment";

const STREAMING_REASONING_PLACEHOLDER = "\u258d";

function prettyDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function renderableStreamingReasoningText(value: string, showPlaceholder: boolean): string {
  if (value.length > 0) {
    return value.trim().length > 0 ? value : STREAMING_REASONING_PLACEHOLDER;
  }
  return showPlaceholder ? STREAMING_REASONING_PLACEHOLDER : "";
}

function InterleavedAssistantMarkdown({ message }: { message: string }) {
  if (message === STREAMING_REASONING_PLACEHOLDER) {
    return (
      <p className="agent-run-interleaved-placeholder m-0">
        <span className="agent-message-caret">{STREAMING_REASONING_PLACEHOLDER}</span>
      </p>
    );
  }
  return <MarkdownRenderer markdown={message} className="agent-run-interleaved-markdown" />;
}

function ReasoningSegmentMarkdown({ message }: { message: string }) {
  if (message === STREAMING_REASONING_PLACEHOLDER) {
    return (
      <p className="agent-run-interleaved-placeholder m-0">
        <span className="agent-message-caret">{STREAMING_REASONING_PLACEHOLDER}</span>
      </p>
    );
  }
  return <MarkdownRenderer markdown={message} className="agent-run-interleaved-markdown" />;
}

function ReasoningSegmentRow({
  item,
  defaultOpen = false,
  onInspectActivity
}: {
  item: Extract<RunActivityItem, { type: "reasoning_step" }>;
  defaultOpen?: boolean;
  onInspectActivity?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const tokenCount = estimateReasoningTokenCount(item.message);
  const summaryLabel = formatThoughtSummaryLabel({
    durationMs: item.durationMs,
    tokenCount
  });

  return (
    <details
      className="agent-reasoning-segment"
      open={isOpen}
      onToggle={(event) => setIsOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary onClick={onInspectActivity}>
        <span className="agent-reasoning-segment-label">{summaryLabel}</span>
        <span className="agent-reasoning-segment-time muted">{prettyDateTime(item.createdAt)}</span>
      </summary>
      {isOpen ? (
        <div className="agent-reasoning-segment-details">
          <ReasoningSegmentMarkdown message={item.message} />
        </div>
      ) : null}
    </details>
  );
}

function StreamingReasoningSegmentRow({
  message,
  startedAt,
  onInspectActivity
}: {
  message: string;
  startedAt?: number | null;
  onInspectActivity?: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isPlaceholder = message === STREAMING_REASONING_PLACEHOLDER;
  const displayMessage = isPlaceholder ? message : tailReasoningLines(message);
  const tokenCount = isPlaceholder ? 0 : estimateReasoningTokenCount(message);
  const summaryLabel =
    startedAt != null
      ? formatThinkingSummaryLabel({ durationMs: Math.max(0, nowMs - startedAt), tokenCount })
      : "Thinking";

  useEffect(() => {
    if (startedAt == null) {
      return;
    }
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 750);
    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  return (
    <details className="agent-reasoning-segment agent-reasoning-segment-streaming" open>
      <summary onClick={onInspectActivity}>
        <span className="agent-reasoning-segment-label">{summaryLabel}</span>
      </summary>
      <div
        className="agent-reasoning-segment-details agent-reasoning-segment-streaming-details"
        style={{ maxHeight: `calc(1.25rem * ${STREAMING_REASONING_TAIL_LINE_COUNT})` }}
      >
        <ReasoningSegmentMarkdown message={displayMessage} />
      </div>
    </details>
  );
}

function ToolCallTimelineRow({
  item,
  defaultOpen,
  onInspectActivity,
  onHydrateToolCall,
  isHydrating = false
}: {
  item: Extract<RunActivityItem, { type: "tool_call" }>;
  defaultOpen?: boolean;
  onInspectActivity?: () => void;
  onHydrateToolCall?: (runId: string, toolCallId: string) => void;
  isHydrating?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(Boolean(defaultOpen));
  const toolCall = item.toolCall;
  const status = toolCall?.status ?? "queued";
  const statusClass = toolStatusClass(status);
  const hasSnapshot = toolCall !== null;
  const hasFullPayload = Boolean(toolCall?.has_full_payload);
  const shouldHydrate = isOpen && !hasFullPayload;
  const showTerminalOutput = hasFullPayload && isToolStatusTerminal(status);

  useEffect(() => {
    if (!shouldHydrate) {
      return;
    }
    if (!onHydrateToolCall) {
      return;
    }
    onHydrateToolCall(item.runId, item.toolCallId);
  }, [item.runId, item.toolCallId, onHydrateToolCall, shouldHydrate]);

  return (
    <details
      className={cn("agent-tool-call", !hasSnapshot && "agent-tool-call-static")}
      open={isOpen}
      onToggle={(event) => setIsOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary onClick={onInspectActivity}>
        <span className="agent-tool-call-name">{toolCall?.display_label ?? toolCall?.tool_name ?? "Tool call"}</span>
        <span className={cn("agent-tool-call-status-dot", statusClass)} title={toolStatusLabel(status)} />
        <span className="agent-tool-call-time muted">{prettyDateTime(item.createdAt)}</span>
      </summary>
      {isOpen ? (
        <div className="agent-tool-call-details">
          {!hasSnapshot ? (
            <>
              <p className="agent-tool-call-details-label">Tool</p>
              <p className="muted agent-tool-call-pending-detail">
                {isHydrating ? "Loading tool snapshot..." : "Waiting for tool snapshot..."}
              </p>
              <pre>{JSON.stringify({ tool_call_id: item.toolCallId }, null, 2)}</pre>
            </>
          ) : !hasFullPayload ? (
            <>
              <p className="agent-tool-call-details-label">Tool details</p>
              <p className="muted agent-tool-call-pending-detail">
                {isHydrating ? "Loading tool call details..." : "Loading on demand..."}
              </p>
              <pre>{JSON.stringify({ tool_call_id: item.toolCallId }, null, 2)}</pre>
            </>
          ) : (
            <>
              <p className="agent-tool-call-details-label">Arguments</p>
              <pre className="agent-tool-call-arguments">{JSON.stringify(toolCall.arguments_json, null, 2)}</pre>
              {showTerminalOutput ? (
                <>
                  <p className="agent-tool-call-details-label">Model-visible tool result</p>
                  <pre className="agent-tool-call-output">{toolCall.output_text || "(empty)"}</pre>
                  <details>
                    <summary className="agent-tool-call-details-label">Structured output (debug)</summary>
                    <pre>{JSON.stringify(toolCall.result_content_json, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <p className="muted agent-tool-call-pending-detail">Waiting for tool result...</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </details>
  );
}

export function AgentRunActivityRows({
  items,
  onInspectActivity,
  onHydrateToolCall,
  hydratingToolCallIds,
  streamingReasoningText = "",
  streamingReasoningStartedAt,
  showStreamingPlaceholder = false,
  defaultOpenReasoningSteps = false
}: {
  items: RunActivityItem[];
  onInspectActivity?: () => void;
  onHydrateToolCall?: (runId: string, toolCallId: string) => void;
  hydratingToolCallIds?: ReadonlySet<string>;
  streamingReasoningText?: string;
  streamingReasoningStartedAt?: number | null;
  showStreamingPlaceholder?: boolean;
  defaultOpenReasoningSteps?: boolean;
}) {
  const visibleStreamingReasoningText = renderableStreamingReasoningText(streamingReasoningText, false);
  const hasStreamingReasoningText = visibleStreamingReasoningText.length > 0;
  return (
    <div className="agent-run-activity-timeline">
      {items.map((item) => {
        if (item.type === "reasoning_step") {
          return (
            <ReasoningSegmentRow
              key={item.key}
              item={item}
              defaultOpen={defaultOpenReasoningSteps}
              onInspectActivity={onInspectActivity}
            />
          );
        }
        if (item.type === "progress_note" || item.type === "assistant_message") {
          return <InterleavedAssistantMarkdown key={item.key} message={item.message} />;
        }
        if (item.type === "tool_call") {
          return (
            <ToolCallTimelineRow
              key={item.key}
              item={item}
              defaultOpen={false}
              onInspectActivity={onInspectActivity}
              onHydrateToolCall={onHydrateToolCall}
              isHydrating={Boolean(hydratingToolCallIds?.has(item.toolCallId))}
            />
          );
        }
        return null;
      })}
      {hasStreamingReasoningText ? (
        <StreamingReasoningSegmentRow
          message={visibleStreamingReasoningText}
          startedAt={streamingReasoningStartedAt}
          onInspectActivity={onInspectActivity}
        />
      ) : null}
      {showStreamingPlaceholder ? (
        <StreamingReasoningSegmentRow
          message={STREAMING_REASONING_PLACEHOLDER}
          startedAt={streamingReasoningStartedAt}
          onInspectActivity={onInspectActivity}
        />
      ) : null}
    </div>
  );
}

export function PendingAssistantActivityBlock({
  steps,
  toolCalls = [],
  liveActivityItems = [],
  onInspectActivity,
  onHydrateToolCall,
  hydratingToolCallIds,
  streamingReasoningText = "",
  streamingReasoningStartedAt,
  defaultOpenReasoningSteps = true
}: {
  steps: AgentRunStep[];
  toolCalls?: AgentToolCall[];
  liveActivityItems?: RunActivityItem[];
  onInspectActivity?: () => void;
  onHydrateToolCall?: (runId: string, toolCallId: string) => void;
  hydratingToolCallIds?: ReadonlySet<string>;
  streamingReasoningText?: string;
  streamingReasoningStartedAt?: number | null;
  defaultOpenReasoningSteps?: boolean;
}) {
  const items = useMemo(
    () =>
      liveActivityItems.length > 0
        ? liveActivityItems
        : toolCalls.length > 0
          ? buildLiveRunTimelineFromToolCalls(toolCalls)
          : buildRunTimelineFromProjections(steps, toolCalls),
    [liveActivityItems, steps, toolCalls]
  );
  const hasStreamingReasoningText = streamingReasoningText.length > 0;
  const showStreamingPlaceholder =
    (steps.length > 0 || toolCalls.length > 0) && items.length === 0 && !hasStreamingReasoningText;

  if (items.length === 0 && !hasStreamingReasoningText && !showStreamingPlaceholder) {
    return null;
  }

  return (
    <AgentRunActivityRows
      items={items}
      onInspectActivity={onInspectActivity}
      onHydrateToolCall={onHydrateToolCall}
      hydratingToolCallIds={hydratingToolCallIds}
      streamingReasoningText={streamingReasoningText}
      streamingReasoningStartedAt={streamingReasoningStartedAt}
      defaultOpenReasoningSteps={defaultOpenReasoningSteps}
    />
  );
}
