/**
 * CALLING SPEC:
 * - Purpose: provide the `activity` frontend module.
 * - Inputs: callers that import `frontend/src/features/agent/activity.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `activity`.
 * - Side effects: module-local frontend behavior only.
 */
import type {
  AgentChangeItem,
  AgentRun,
  AgentRunStep,
  AgentRunWithLiveUsage,
  AgentThreadDetail,
  AgentToolCallStatus,
  AgentTurn
} from "../../lib/types";
import { listOrEmpty } from "../../lib/collections";

export type RunToolCall = NonNullable<AgentRun["tool_calls"]>[number];

interface RunActivityReasoningStep {
  type: "reasoning_step";
  key: string;
  runId: string;
  stepId: string;
  message: string;
  durationMs: number | null;
  createdAt: string;
}

interface RunActivityProgressNote {
  type: "progress_note";
  key: string;
  runId: string;
  stepId: string;
  message: string;
  createdAt: string;
}

interface RunActivityAssistantMessage {
  type: "assistant_message";
  key: string;
  runId: string;
  stepId: string;
  message: string;
  createdAt: string;
}

interface RunActivityToolCallItem {
  type: "tool_call";
  key: string;
  runId: string;
  toolCallId: string;
  toolCall: RunToolCall | null;
  createdAt: string;
}

export type RunActivityItem =
  | RunActivityReasoningStep
  | RunActivityProgressNote
  | RunActivityAssistantMessage
  | RunActivityToolCallItem;

function byTimestamp(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

function sortedToolCalls(toolCalls: RunToolCall[]): RunToolCall[] {
  return [...toolCalls].sort((left, right) => {
    if (left.step_id !== right.step_id) {
      return left.step_id.localeCompare(right.step_id);
    }
    return left.call_index - right.call_index;
  });
}

function sortedSteps(steps: AgentRunStep[]): AgentRunStep[] {
  return [...steps].sort((left, right) => left.step_index - right.step_index);
}

export function sortRunsByCreatedAt<T extends AgentRun>(runs: T[]): T[] {
  return [...runs].sort((left, right) => byTimestamp(left.created_at, right.created_at));
}

export function runById(detail: AgentThreadDetail | undefined): Map<string, AgentRun> {
  const map = new Map<string, AgentRun>();
  (detail?.runs ?? []).forEach((run) => {
    map.set(run.id, run);
  });
  return map;
}

export function visibleTurns(detail: AgentThreadDetail | undefined): AgentTurn[] {
  return [...(detail?.turns ?? [])].sort((left, right) => left.turn_index - right.turn_index);
}

export function pendingRuns(detail: AgentThreadDetail | undefined): AgentRun[] {
  const completedRunIds = new Set(
    (detail?.turns ?? [])
      .filter((turn) => Boolean(turn.assistant_message?.content_markdown.trim()))
      .map((turn) => turn.run_id)
  );
  return sortRunsByCreatedAt(
    (detail?.runs ?? []).filter((run) => !completedRunIds.has(run.id) || run.status === "running")
  );
}

export function pendingRunsByTurnRunId(detail: AgentThreadDetail | undefined): Map<string, AgentRun[]> {
  const map = new Map<string, AgentRun[]>();
  pendingRuns(detail).forEach((run) => {
    const turn = (detail?.turns ?? []).find((item) => item.run_id === run.id);
    if (!turn) {
      const unattached = map.get("__unattached__");
      if (unattached) {
        unattached.push(run);
      } else {
        map.set("__unattached__", [run]);
      }
      return;
    }
    const runs = map.get(turn.run_id);
    if (runs) {
      runs.push(run);
      return;
    }
    map.set(turn.run_id, [run]);
  });
  return map;
}

export function totalRunMetric(
  runs: AgentRun[],
  field: "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens" | "total_cost_usd"
): number | null {
  let total = 0;
  let hasValue = false;
  runs.forEach((run) => {
    const value = run[field];
    if (typeof value === "number") {
      total += value;
      hasValue = true;
    }
  });
  return hasValue ? total : null;
}

export function latestRunMetric(
  runs: AgentRun[],
  field: "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens" | "total_cost_usd"
): number | null {
  const sorted = sortRunsByCreatedAt(runs);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const value = sorted[index][field];
    if (typeof value === "number") {
      return value;
    }
  }
  return null;
}

export function buildThreadUsageTotals(detail: AgentThreadDetail | undefined): {
  context: number | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  totalCost: number | null;
} {
  const runs = detail?.runs ?? [];
  return {
    context: detail?.current_context_tokens ?? null,
    input: totalRunMetric(runs, "input_tokens"),
    output: totalRunMetric(runs, "output_tokens"),
    cacheRead: totalRunMetric(runs, "cache_read_tokens"),
    totalCost: totalRunMetric(runs, "total_cost_usd")
  };
}

/** Mirrors backend `current_context_tokens_for_thread` when cached runs carry live SSE usage. */
export function recomputeThreadCurrentContextTokens(runs: AgentRunWithLiveUsage[]): number | null {
  const sorted = sortRunsByCreatedAt(runs);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const run = sorted[index];
    if (run.status === "running" && run.context_tokens != null) {
      return run.context_tokens;
    }
  }
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const run = sorted[index];
    if (run.context_tokens != null) {
      return run.context_tokens;
    }
  }
  return null;
}

export function summarizeRunChangeTypes(changeItems: AgentChangeItem[]): {
  entryCount: number;
  tagCount: number;
  entityCount: number;
  groupCount: number;
} {
  let entryCount = 0;
  let tagCount = 0;
  let entityCount = 0;
  let groupCount = 0;

  changeItems.forEach((item) => {
    if (item.change_type.endsWith("_entry")) {
      entryCount += 1;
      return;
    }
    if (item.change_type.includes("group")) {
      groupCount += 1;
      return;
    }
    if (item.change_type.endsWith("_tag")) {
      tagCount += 1;
      return;
    }
    if (item.change_type.endsWith("_entity")) {
      entityCount += 1;
    }
  });

  return { entryCount, tagCount, entityCount, groupCount };
}

export function mergeRunSteps(persisted: AgentRunStep[], optimistic: AgentRunStep[] = []): AgentRunStep[] {
  const byId = new Map<string, AgentRunStep>();
  [...persisted, ...optimistic].forEach((step) => {
    const existing = byId.get(step.id);
    if (!existing) {
      byId.set(step.id, step);
      return;
    }
    byId.set(step.id, {
      ...existing,
      ...step,
      reasoning_text: step.reasoning_text ?? existing.reasoning_text,
      progress_note: step.progress_note ?? existing.progress_note,
      reasoning_duration_ms: step.reasoning_duration_ms ?? existing.reasoning_duration_ms
    });
  });
  return sortedSteps([...byId.values()]);
}

function mergeToolCallSnapshot(current: RunToolCall, incoming: RunToolCall): RunToolCall {
  const shouldPreserveCurrentPayload = current.has_full_payload && !incoming.has_full_payload;

  return {
    ...current,
    ...incoming,
    arguments_json: shouldPreserveCurrentPayload ? current.arguments_json : incoming.arguments_json,
    result_content_json: shouldPreserveCurrentPayload ? current.result_content_json : incoming.result_content_json,
    output_text: shouldPreserveCurrentPayload ? current.output_text : incoming.output_text,
    has_full_payload: current.has_full_payload || incoming.has_full_payload
  };
}

export function mergeRunToolCalls(persisted: RunToolCall[], optimistic: RunToolCall[] = []): RunToolCall[] {
  const byId = new Map<string, RunToolCall>();
  [...persisted, ...optimistic].forEach((toolCall) => {
    const existing = byId.get(toolCall.id);
    byId.set(toolCall.id, existing ? mergeToolCallSnapshot(existing, toolCall) : toolCall);
  });
  return sortedToolCalls([...byId.values()]);
}

/** Flat tool timeline for in-flight runs; avoids step-id churn while the harness advances steps. */
export function buildLiveRunTimelineFromToolCalls(toolCalls: RunToolCall[]): RunActivityItem[] {
  return mergeRunToolCalls(toolCalls).map((toolCall) => ({
    type: "tool_call",
    key: toolCall.id,
    runId: toolCall.run_id,
    toolCallId: toolCall.id,
    toolCall,
    createdAt: toolCall.started_at ?? toolCall.completed_at ?? toolCall.run_id
  }));
}

export function appendLiveActivityLedgerItem(
  ledger: RunActivityItem[],
  item: RunActivityItem
): RunActivityItem[] {
  const existingIndex = ledger.findIndex((entry) => entry.key === item.key);
  if (existingIndex < 0) {
    return [...ledger, item];
  }
  const next = [...ledger];
  const existing = next[existingIndex];
  next[existingIndex] =
    existing.type === "tool_call" && item.type === "tool_call"
      ? {
          ...item,
          createdAt: existing.createdAt,
          toolCall:
            existing.toolCall && item.toolCall
              ? mergeToolCallSnapshot(existing.toolCall, item.toolCall)
              : item.toolCall ?? existing.toolCall
        }
      : { ...item, createdAt: existing.createdAt };
  return next;
}

export function reconcileLiveActivityLedgerToolCalls(
  ledger: RunActivityItem[],
  toolCalls: RunToolCall[]
): RunActivityItem[] {
  const toolCallById = new Map(mergeRunToolCalls(toolCalls).map((toolCall) => [toolCall.id, toolCall]));
  return ledger.map((item) => {
    if (item.type !== "tool_call") {
      return item;
    }
    const latest = toolCallById.get(item.toolCallId);
    if (!latest) {
      return item;
    }
    return {
      ...item,
      toolCall: latest,
      createdAt: item.createdAt
    };
  });
}

export function buildLiveRunActivityItems(
  runs: AgentRun[],
  getOptimistic: (runId: string) => { steps: AgentRunStep[]; toolCalls: RunToolCall[] },
  liveLedgerByRunId: Record<string, RunActivityItem[]>
): RunActivityItem[] {
  const merged: RunActivityItem[] = [];
  sortRunsByCreatedAt(runs).forEach((run) => {
    const { steps: optSteps, toolCalls: optToolCalls } = getOptimistic(run.id);
    const mergedToolCalls = mergeRunToolCalls(listOrEmpty(run.tool_calls), optToolCalls);
    const ledger = liveLedgerByRunId[run.id] ?? [];
    if (ledger.length > 0) {
      const reconciledLedger = reconcileLiveActivityLedgerToolCalls(ledger, mergedToolCalls);
      reconciledLedger.forEach((item) => {
        merged.push({
          ...item,
          key: `${run.id}:${item.key}`
        });
      });
      return;
    }
    const mergedSteps = mergeRunSteps(listOrEmpty(run.steps), optSteps);
    const mergedRunItems = buildRunTimelineFromProjections(mergedSteps, mergedToolCalls);
    mergedRunItems.sort((left, right) => byTimestamp(left.createdAt, right.createdAt));
    mergedRunItems.forEach((item) => {
      merged.push({
        ...item,
        key: `${run.id}:${item.key}`
      });
    });
  });
  return merged;
}

function toolCallsForStep(stepId: string, toolCalls: RunToolCall[]): RunToolCall[] {
  return toolCalls.filter((toolCall) => toolCall.step_id === stepId);
}

export function buildRunTimelineFromProjections(steps: AgentRunStep[], toolCalls: RunToolCall[]): RunActivityItem[] {
  const mergedSteps = sortedSteps(steps);
  const mergedToolCalls = mergeRunToolCalls(toolCalls);
  const toolCallById = new Map(mergedToolCalls.map((toolCall) => [toolCall.id, toolCall]));
  const timeline: RunActivityItem[] = [];

  mergedSteps.forEach((step) => {
    const reasoning = (step.reasoning_text ?? "").trim();
    if (reasoning) {
      timeline.push({
        type: "reasoning_step",
        key: `${step.id}:reasoning`,
        runId: step.run_id,
        stepId: step.id,
        message: reasoning,
        durationMs: step.reasoning_duration_ms ?? null,
        createdAt: step.created_at
      });
    }

    toolCallsForStep(step.id, mergedToolCalls).forEach((toolCall) => {
      timeline.push({
        type: "tool_call",
        key: toolCall.id,
        runId: step.run_id,
        toolCallId: toolCall.id,
        toolCall: toolCallById.get(toolCall.id) ?? toolCall,
        createdAt: toolCall.started_at ?? toolCall.completed_at ?? step.created_at
      });
    });

    const progressNote = (step.progress_note ?? "").trim();
    if (progressNote) {
      timeline.push({
        type: "progress_note",
        key: `${step.id}:progress`,
        runId: step.run_id,
        stepId: step.id,
        message: progressNote,
        createdAt: step.created_at
      });
    }
  });

  const referencedToolIds = new Set(
    timeline.filter((item): item is RunActivityToolCallItem => item.type === "tool_call").map((item) => item.toolCallId)
  );
  mergedToolCalls.forEach((toolCall) => {
    if (referencedToolIds.has(toolCall.id)) {
      return;
    }
    timeline.push({
      type: "tool_call",
      key: toolCall.id,
      runId: toolCall.run_id,
      toolCallId: toolCall.id,
      toolCall,
      createdAt: toolCall.started_at ?? toolCall.completed_at ?? toolCall.run_id
    });
  });

  timeline.sort((left, right) => byTimestamp(left.createdAt, right.createdAt));
  return timeline;
}

export function countActivityMetrics(items: RunActivityItem[]): {
  toolCount: number;
  updateCount: number;
} {
  const reasoningCount = items.filter((item) => item.type === "reasoning_step").length;
  const noteCount = items.filter((item) => item.type === "progress_note" || item.type === "assistant_message").length;
  return {
    toolCount: items.filter((item) => item.type === "tool_call").length,
    updateCount: reasoningCount + noteCount
  };
}

/** Wall-clock span from earliest run start to latest run end (uses completed_at when set, else created_at). */
export function aggregateWorkDurationMs(runs: AgentRun[]): number | null {
  if (runs.length === 0) {
    return null;
  }
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  runs.forEach((run) => {
    const start = new Date(run.created_at).getTime();
    if (!Number.isNaN(start)) {
      minStart = Math.min(minStart, start);
    }
    const endRaw = run.completed_at ?? run.created_at;
    const end = new Date(endRaw).getTime();
    if (!Number.isNaN(end)) {
      maxEnd = Math.max(maxEnd, end);
    }
  });
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd < minStart) {
    return null;
  }
  return maxEnd - minStart;
}

export function formatWorkedDurationLabel(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes >= 1) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function buildAgentWorkSeparatorLabel(runs: AgentRun[], items: RunActivityItem[]): string {
  const durationMs = aggregateWorkDurationMs(runs);
  const { toolCount, updateCount } = countActivityMetrics(items);
  const parts: string[] = [];
  if (durationMs !== null && durationMs >= 0) {
    parts.push(`Worked for ${formatWorkedDurationLabel(durationMs)}`);
  }
  if (toolCount > 0) {
    parts.push(`${toolCount} tool call${toolCount === 1 ? "" : "s"}`);
  }
  if (updateCount > 0) {
    parts.push(`${updateCount} update${updateCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ") || "Agent activity";
}

export function mergeRunActivityItems(
  runs: AgentRun[],
  getOptimistic: (runId: string) => { steps: AgentRunStep[]; toolCalls: RunToolCall[] }
): RunActivityItem[] {
  const merged: RunActivityItem[] = [];
  sortRunsByCreatedAt(runs).forEach((run) => {
    const { steps: optSteps, toolCalls: optToolCalls } = getOptimistic(run.id);
    const mergedSteps = mergeRunSteps(listOrEmpty(run.steps), optSteps);
    const mergedToolCalls = mergeRunToolCalls(listOrEmpty(run.tool_calls), optToolCalls);
    const items = buildRunTimelineFromProjections(mergedSteps, mergedToolCalls);
    items.forEach((item) => {
      merged.push({
        ...item,
        key: `${run.id}:${item.key}`
      });
    });
  });
  merged.sort((left, right) => byTimestamp(left.createdAt, right.createdAt));
  return merged;
}

export function toolStatusLabel(status: AgentToolCallStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "ok":
      return "Completed";
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function toolStatusClass(status: AgentToolCallStatus): string {
  switch (status) {
    case "queued":
      return "is-queued";
    case "running":
      return "is-running";
    case "ok":
      return "is-completed";
    case "error":
      return "is-failed";
    case "cancelled":
      return "is-cancelled";
  }
}

export function isToolStatusTerminal(status: AgentToolCallStatus): boolean {
  return status === "ok" || status === "error" || status === "cancelled";
}

export function runErrorText(run: AgentRun): string | null {
  return run.error_detail?.trim() || run.error_code?.trim() || null;
}
