/**
 * CALLING SPEC:
 * - Purpose: format and estimate metrics for collapsed model-reasoning segments.
 * - Inputs: callers that import `frontend/src/features/agent/reasoning_segment.ts`.
 * - Outputs: token estimate and summary label helpers.
 * - Side effects: none.
 */

export function estimateReasoningTokenCount(message: string): number {
  const trimmed = message.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function formatThoughtDurationLabel(durationMs: number): string {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function formatThoughtSummaryLabel({
  durationMs,
  tokenCount
}: {
  durationMs: number | null | undefined;
  tokenCount: number;
}): string {
  const tokenLabel = formatReasoningTokenLabel(tokenCount);
  if (durationMs == null || durationMs <= 0) {
    return `Thought · ${tokenLabel}`;
  }
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  return `Thought for ${seconds}s · ${tokenLabel}`;
}

export function formatThinkingSummaryLabel({
  durationMs,
  tokenCount
}: {
  durationMs: number;
  tokenCount: number;
}): string {
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  return `Thinking for ${seconds}s · ${formatReasoningTokenLabel(tokenCount)}`;
}

function formatReasoningTokenLabel(tokenCount: number): string {
  return `${tokenCount.toLocaleString()} token${tokenCount === 1 ? "" : "s"}`;
}

export function isModelReasoningSource(source: string | null | undefined): boolean {
  return source === "model_reasoning";
}

export const STREAMING_REASONING_TAIL_LINE_COUNT = 9;

/** Keep only the trailing lines of in-flight model reasoning for the live stream view. */
export function tailReasoningLines(text: string, maxLines = STREAMING_REASONING_TAIL_LINE_COUNT): string {
  if (!text || maxLines <= 0) {
    return text;
  }
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return text;
  }
  return lines.slice(-maxLines).join("\n");
}
