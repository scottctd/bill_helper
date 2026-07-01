/**
 * CALLING SPEC:
 * - Purpose: unit-test pure SSE reducer transitions per event type.
 * - Inputs: synthetic AgentStreamEvent payloads and empty session state.
 * - Outputs: vitest assertions on state and effect lists.
 * - Side effects: none.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent } from "../../../lib/types";
import type { AgentStreamSessionState } from "./agentStreamSession";
import { applyStreamEvent, createEmptyAgentStreamSessionState } from "./streamReducer";

const THREAD_ID = "thread-1";
const RUN_ID = "run-1";
const FIXED_ISO = "2026-07-01T12:00:00.000Z";
const FIXED_MS = new Date(FIXED_ISO).getTime();

function context(overrides: { threadId?: string } = {}) {
  return {
    threadId: overrides.threadId ?? THREAD_ID,
    nowMs: () => FIXED_MS,
    nowIso: () => FIXED_ISO
  };
}

function reduce(state: AgentStreamSessionState, event: AgentStreamEvent) {
  return applyStreamEvent(state, event, context());
}

describe("applyStreamEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks sequence index and active run for thread", () => {
    const initial = createEmptyAgentStreamSessionState();
    const { state } = reduce(initial, {
      type: "run_started",
      run_id: RUN_ID,
      sequence_index: 3
    });
    expect(state.lastSequenceIndexByRunId[RUN_ID]).toBe(3);
    expect(state.activeStreamRunIdsByThreadId[THREAD_ID]).toBe(RUN_ID);
  });

  it("appends reasoning_delta text", () => {
    const initial = createEmptyAgentStreamSessionState();
    const first = reduce(initial, { type: "reasoning_delta", run_id: RUN_ID, delta: "Think" });
    expect(first.state.streamedReasoningTextByRunId[RUN_ID]).toBe("Think");
    expect(first.state.reasoningSegmentStartedAtByRunId[RUN_ID]).toBe(FIXED_MS);
    const second = reduce(first.state, { type: "reasoning_delta", run_id: RUN_ID, delta: " more" });
    expect(second.state.streamedReasoningTextByRunId[RUN_ID]).toBe("Think more");
  });

  it("appends text_delta content", () => {
    const initial = createEmptyAgentStreamSessionState();
    const { state } = reduce(initial, { type: "text_delta", run_id: RUN_ID, delta: "Hello" });
    expect(state.streamedTextByRunId[RUN_ID]).toBe("Hello");
  });

  it("routes model_delta reasoning and content separately", () => {
    const initial = createEmptyAgentStreamSessionState();
    const reasoning = reduce(initial, {
      type: "model_delta",
      run_id: RUN_ID,
      step_index: 0,
      delta_type: "reasoning",
      text: "R"
    });
    expect(reasoning.state.streamedReasoningTextByRunId[RUN_ID]).toBe("R");
    const content = reduce(reasoning.state, {
      type: "model_delta",
      run_id: RUN_ID,
      step_index: 0,
      delta_type: "content",
      text: "A"
    });
    expect(content.state.streamedTextByRunId[RUN_ID]).toBe("A");
  });

  it("handles run_started with optional run_usage effect", () => {
    const initial = createEmptyAgentStreamSessionState();
    const { effects } = reduce(initial, {
      type: "run_started",
      run_id: RUN_ID,
      run_usage: {
        context_tokens: null,
        input_tokens: 10,
        output_tokens: 2,
        cache_read_tokens: null,
        cache_write_tokens: null,
        input_cost_usd: null,
        output_cost_usd: null,
        total_cost_usd: null
      }
    });
    expect(effects).toEqual([
      {
        type: "patch_run_usage",
        threadId: THREAD_ID,
        runId: RUN_ID,
        runUsage: {
          context_tokens: null,
          input_tokens: 10,
          output_tokens: 2,
          cache_read_tokens: null,
          cache_write_tokens: null,
          input_cost_usd: null,
          output_cost_usd: null,
          total_cost_usd: null
        }
      }
    ]);
  });

  it("no-ops model_request_started and step_committed with run_usage", () => {
    const initial = createEmptyAgentStreamSessionState();
    const request = reduce(initial, {
      type: "model_request_started",
      run_id: RUN_ID,
      step_index: 1,
      run_usage: {
        context_tokens: null,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        input_cost_usd: null,
        output_cost_usd: null,
        total_cost_usd: 0.01
      }
    });
    expect(request.state.optimisticStepsByRunId).toEqual({});
    expect(request.effects[0]?.type).toBe("patch_run_usage");
    const step = reduce(request.state, {
      type: "step_committed",
      run_id: RUN_ID,
      step_index: 1
    });
    expect(step.effects).toEqual([]);
  });

  it("commits model_decision with ledger, cache patch, and buffer cleanup", () => {
    let state = createEmptyAgentStreamSessionState();
    state = {
      ...state,
      streamedReasoningTextByRunId: { [RUN_ID]: " streamed " },
      streamedTextByRunId: { [RUN_ID]: "partial" },
      reasoningSegmentStartedAtByRunId: { [RUN_ID]: FIXED_MS - 500 }
    };
    const { state: next, effects } = reduce(state, {
      type: "model_decision_committed",
      run_id: RUN_ID,
      step_index: 0,
      assistant_message_id: "msg-1",
      has_tool_requests: true,
      reasoning_text: "fallback"
    });
    expect(next.optimisticStepsByRunId[RUN_ID]).toHaveLength(1);
    expect(next.optimisticStepsByRunId[RUN_ID]?.[0]?.reasoning_text).toBe(" streamed ");
    expect(next.streamedReasoningTextByRunId[RUN_ID]).toBeUndefined();
    expect(next.streamedTextByRunId[RUN_ID]).toBeUndefined();
    expect(next.liveActivityLedgerByRunId[RUN_ID]).toHaveLength(2);
    expect(effects).toEqual([
      expect.objectContaining({
        type: "patch_thread_cache",
        event: expect.objectContaining({ type: "model_decision_committed" }),
        reasoningText: " streamed "
      })
    ]);
  });

  it("handles tool_started with hydrate effect for rename_thread", () => {
    const { state, effects } = reduce(createEmptyAgentStreamSessionState(), {
      type: "tool_started",
      run_id: RUN_ID,
      step_index: 0,
      tool_call_id: "tc-1",
      tool_name: "rename_thread"
    });
    expect(state.optimisticToolCallsByRunId[RUN_ID]).toHaveLength(1);
    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "patch_thread_cache" }),
        expect.objectContaining({ type: "hydrate_tool_call", toolCallId: "tc-1" })
      ])
    );
  });

  it("handles tool_finished with invalidate on rename_thread error", () => {
    let state = createEmptyAgentStreamSessionState();
    state = reduce(state, {
      type: "tool_started",
      run_id: RUN_ID,
      step_index: 0,
      tool_call_id: "tc-1",
      tool_name: "rename_thread"
    }).state;
    const finished = reduce(state, {
      type: "tool_finished",
      run_id: RUN_ID,
      step_index: 0,
      tool_call_id: "tc-1",
      tool_name: "rename_thread",
      status: "error"
    });
    expect(finished.state.optimisticToolCallsByRunId[RUN_ID]?.[0]?.status).toBe("error");
    expect(finished.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalidate_thread" })])
    );
  });

  it("clears streamed text on run_finished when final content matches", () => {
    let state = createEmptyAgentStreamSessionState();
    state = {
      ...state,
      streamedTextByRunId: { [RUN_ID]: "Done." }
    };
    const { state: next, effects } = reduce(state, {
      type: "run_finished",
      run_id: RUN_ID,
      status: "completed",
      final_assistant_content: "Done."
    });
    expect(next.streamedTextByRunId[RUN_ID]).toBeUndefined();
    expect(effects).toEqual([
      expect.objectContaining({ type: "patch_thread_cache", event: expect.objectContaining({ type: "run_finished" }) })
    ]);
  });

  it("warns and no-ops unknown event types", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unknownEvent = { type: "future_event", run_id: RUN_ID } as unknown as AgentStreamEvent;
    const { state, effects } = reduce(createEmptyAgentStreamSessionState(), unknownEvent);
    expect(state.activeStreamRunIdsByThreadId[THREAD_ID]).toBe(RUN_ID);
    expect(effects).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
