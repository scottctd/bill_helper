/**
 * CALLING SPEC:
 * - Purpose: patch cached `AgentThreadDetail` in React Query from incremental SSE data.
 * - Inputs: `QueryClient`, thread id, run id, stream events, and usage payloads.
 * - Outputs: cache patch helpers for live run reconciliation.
 * - Side effects: updates thread detail query data in place when a matching run exists.
 */
import type { QueryClient } from "@tanstack/react-query";

import { listOrEmpty } from "../../lib/collections";
import { queryKeys } from "../../lib/queryKeys";
import type {
  AgentRun,
  AgentRunStep,
  AgentRunWithLiveUsage,
  AgentStreamEvent,
  AgentStreamRunUsage,
  AgentThreadDetail,
  AgentToolCall,
  AgentToolCallStatus
} from "../../lib/types";
import { mergeRunSteps, mergeRunToolCalls, recomputeThreadCurrentContextTokens } from "./activity";

const RUN_USAGE_PATCH_FIELDS: (keyof AgentStreamRunUsage)[] = [
  "context_tokens",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "input_cost_usd",
  "output_cost_usd",
  "total_cost_usd"
];

function mapHarnessToolStatus(status: string): AgentToolCallStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "ok":
      return "ok";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function buildCachedToolCallFromStarted(
  event: Extract<AgentStreamEvent, { type: "tool_started" }>
): AgentToolCall {
  const now = new Date().toISOString();
  return {
    id: event.tool_call_id,
    run_id: event.run_id,
    step_id: `stream-step-${event.run_id}-${event.step_index}`,
    call_index: 0,
    tool_request_id: event.tool_call_id,
    tool_name: event.tool_name,
    display_label: event.display_label ?? event.tool_name,
    display_detail: event.display_detail ?? null,
    arguments_json: null,
    result_content_json: null,
    output_text: null,
    has_full_payload: false,
    status: "running",
    error_code: null,
    started_at: now,
    completed_at: null
  };
}

function buildCachedStepFromCommit(
  event: Extract<AgentStreamEvent, { type: "model_decision_committed" }>,
  reasoningText: string
): AgentRunStep {
  return {
    id: event.assistant_message_id,
    run_id: event.run_id,
    step_index: event.step_index,
    status: "committed",
    reasoning_text: reasoningText.trim().length > 0 ? reasoningText : null,
    progress_note: null,
    reasoning_duration_ms: null,
    latency_ms: null,
    created_at: new Date().toISOString()
  };
}

function patchRunInDetail(
  current: AgentThreadDetail,
  runId: string,
  patchRun: (run: AgentRunWithLiveUsage) => AgentRunWithLiveUsage
): AgentThreadDetail {
  let mutated = false;
  const runs = current.runs.map((run) => {
    if (run.id !== runId) {
      return run;
    }
    mutated = true;
    return patchRun(run);
  });
  if (!mutated) {
    return current;
  }
  return {
    ...current,
    runs,
    current_context_tokens: recomputeThreadCurrentContextTokens(runs) ?? current.current_context_tokens
  };
}

export function patchAgentThreadCachedToolCall(
  queryClient: QueryClient,
  threadId: string,
  runId: string,
  toolCall: AgentToolCall
): void {
  queryClient.setQueryData(queryKeys.agent.thread(threadId), (current: AgentThreadDetail | undefined) => {
    if (!current) {
      return current;
    }
    return patchRunInDetail(current, runId, (run) => ({
      ...run,
      tool_calls: mergeRunToolCalls(listOrEmpty(run.tool_calls), [toolCall])
    }));
  });
}

export function patchAgentThreadCachedRunUsage(
  queryClient: QueryClient,
  threadId: string,
  runId: string,
  runUsage: AgentStreamRunUsage
): void {
  queryClient.setQueryData(queryKeys.agent.thread(threadId), (current: AgentThreadDetail | undefined) => {
    if (!current) {
      return current;
    }
    let mutated = false;
    const runs = current.runs.map((run) => {
      if (run.id !== runId) {
        return run;
      }
      let next: AgentRunWithLiveUsage = run;
      for (const key of RUN_USAGE_PATCH_FIELDS) {
        const value = runUsage[key];
        if (value != null) {
          if (next === run) {
            next = { ...run };
            mutated = true;
          }
          next[key] = value;
        }
      }
      return next;
    });
    if (!mutated) {
      return current;
    }
    const nextContext = recomputeThreadCurrentContextTokens(runs);
    return {
      ...current,
      runs,
      current_context_tokens: nextContext ?? current.current_context_tokens
    };
  });
}

export function patchAgentThreadCacheFromStreamEvent(
  queryClient: QueryClient,
  threadId: string,
  event: AgentStreamEvent,
  options?: { reasoningText?: string }
): void {
  queryClient.setQueryData(queryKeys.agent.thread(threadId), (current: AgentThreadDetail | undefined) => {
    if (!current) {
      return current;
    }

    if (event.type === "model_decision_committed") {
      const reasoningText =
        (options?.reasoningText ?? "").trim() || (event.reasoning_text ?? "").trim();
      const step = buildCachedStepFromCommit(event, reasoningText);
      return patchRunInDetail(current, event.run_id, (run) => ({
        ...run,
        steps: mergeRunSteps(listOrEmpty(run.steps), [step])
      }));
    }

    if (event.type === "tool_started") {
      const toolCall = buildCachedToolCallFromStarted(event);
      return patchRunInDetail(current, event.run_id, (run) => ({
        ...run,
        tool_calls: mergeRunToolCalls(listOrEmpty(run.tool_calls), [toolCall])
      }));
    }

    if (event.type === "tool_finished") {
      const status = mapHarnessToolStatus(event.status);
      const now = new Date().toISOString();
      return patchRunInDetail(current, event.run_id, (run) => {
        const existing = listOrEmpty(run.tool_calls).find((toolCall) => toolCall.id === event.tool_call_id);
        const patch: AgentToolCall = existing
          ? {
              ...existing,
              display_label: event.display_label ?? existing.display_label,
              display_detail: event.display_detail ?? existing.display_detail,
              status,
              completed_at: now
            }
          : {
              ...buildCachedToolCallFromStarted({
                type: "tool_started",
                run_id: event.run_id,
                step_index: event.step_index,
                tool_call_id: event.tool_call_id,
                tool_name: event.tool_name,
                display_label: event.display_label,
                display_detail: event.display_detail
              }),
              status,
              completed_at: now
            };
        return {
          ...run,
          tool_calls: mergeRunToolCalls(listOrEmpty(run.tool_calls), [patch])
        };
      });
    }

    if (event.type === "run_finished") {
      const finalContent = (event.final_assistant_content ?? "").trim();
      const completedAt = new Date().toISOString();
      const withRuns = patchRunInDetail(current, event.run_id, (run) => ({
        ...run,
        status: event.status,
        final_assistant_reply: finalContent || run.final_assistant_reply,
        completed_at: run.completed_at ?? completedAt,
        error_code: event.terminal_error?.code ?? run.error_code,
        error_detail: event.terminal_error?.detail ?? run.error_detail
      }));
      if (!finalContent) {
        return {
          ...withRuns,
          turns: withRuns.turns.map((turn) =>
            turn.run_id === event.run_id ? { ...turn, status: event.status } : turn
          )
        };
      }
      return {
        ...withRuns,
        turns: withRuns.turns.map((turn) => {
          if (turn.run_id !== event.run_id) {
            return turn;
          }
          const assistantMessage = turn.assistant_message;
          return {
            ...turn,
            status: event.status,
            assistant_message: assistantMessage
              ? { ...assistantMessage, content_markdown: finalContent }
              : {
                  id: `stream-assistant-${event.run_id}`,
                  role: "assistant",
                  content_markdown: finalContent,
                  reasoning_text: null,
                  created_at: completedAt,
                  attachments: []
                }
          };
        })
      };
    }

    return current;
  });
}
