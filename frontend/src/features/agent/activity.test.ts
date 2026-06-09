import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendLiveActivityLedgerItem,
  buildLiveRunActivityItems,
  buildLiveRunTimelineFromToolCalls,
  buildRunTimelineFromProjections,
  buildThreadUsageTotals,
  latestRunMetric,
  mergeRunSteps,
  mergeRunToolCalls,
  pendingRuns,
  recomputeThreadCurrentContextTokens,
  reconcileLiveActivityLedgerToolCalls,
  runById,
  sortRunsByCreatedAt,
  summarizeRunChangeTypes,
  totalRunMetric
} from "./activity";
import { buildChangeItem, buildRun, buildStep, buildToolCall, buildTurn } from "../../test/factories/agent";
import type { AgentThreadDetail } from "../../lib/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("activity helpers", () => {
  it("builds interleaved timeline from step projections and tool calls", () => {
    const toolCall = buildToolCall({ id: "tool-1", step_id: "step-1", tool_name: "list_entries" });
    const timeline = buildRunTimelineFromProjections(
      [
        buildStep({
          id: "step-1",
          step_index: 1,
          reasoning_text: null,
          progress_note: "Looking up historical entries"
        })
      ],
      [toolCall]
    );

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ type: "tool_call", toolCallId: "tool-1" });
    expect(timeline[1]).toMatchObject({ type: "progress_note", message: "Looking up historical entries" });
  });

  it("renders reasoning steps before tool calls within a step", () => {
    const timeline = buildRunTimelineFromProjections(
      [
        buildStep({
          id: "step-1",
          step_index: 1,
          reasoning_text: "Checking entities before proposing changes.",
          reasoning_duration_ms: 3200
        })
      ],
      [buildToolCall({ id: "tool-1", step_id: "step-1" })]
    );

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ type: "reasoning_step" });
    expect(timeline[1]).toMatchObject({ type: "tool_call", toolCallId: "tool-1" });
  });

  it("does not reconstruct activity from tool rows when step projections are missing", () => {
    const timeline = buildRunTimelineFromProjections(
      [],
      [buildToolCall({ id: "tool-1", tool_name: "legacy_tool", status: "ok" })]
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ type: "tool_call", toolCallId: "tool-1" });
  });

  it("merges persisted and optimistic steps without duplicates", () => {
    const merged = mergeRunSteps(
      [buildStep({ id: "step-1", step_index: 1 })],
      [buildStep({ id: "step-1", step_index: 1, progress_note: "Continuing with the next batch" })]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "step-1", progress_note: "Continuing with the next batch" });
  });

  it("merges optimistic tool snapshots over older persisted tool rows", () => {
    const merged = mergeRunToolCalls(
      [buildToolCall({ id: "tool-1", status: "queued", output_text: "" })],
      [buildToolCall({ id: "tool-1", status: "ok", output_text: "OK" })]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "tool-1", status: "ok", output_text: "OK" });
  });

  it("keeps prior live ledger tool rows when later steps use different step ids", () => {
    const toolOne = buildToolCall({
      id: "tool-1",
      run_id: "run-1",
      step_id: "stream-step-run-1-1",
      status: "ok"
    });
    const toolTwo = buildToolCall({
      id: "tool-2",
      run_id: "run-1",
      step_id: "stream-step-run-1-2",
      status: "running"
    });
    const ledger = [
      {
        type: "tool_call" as const,
        key: "tool-1",
        runId: "run-1",
        toolCallId: "tool-1",
        toolCall: toolOne,
        createdAt: "2026-02-15T10:00:01.000Z"
      },
      {
        type: "tool_call" as const,
        key: "tool-2",
        runId: "run-1",
        toolCallId: "tool-2",
        toolCall: toolTwo,
        createdAt: "2026-02-15T10:00:02.000Z"
      }
    ];

    const items = buildLiveRunActivityItems(
      [buildRun({ id: "run-1", status: "running", tool_calls: [toolOne], steps: [] })],
      () => ({ steps: [], toolCalls: [toolTwo] }),
      { "run-1": ledger }
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.type === "tool_call" && item.toolCallId)).toEqual(["tool-1", "tool-2"]);
  });

  it("preserves live ledger event order instead of timestamp sorting", () => {
    const ledger = [
      {
        type: "reasoning_step" as const,
        key: "step-1:reasoning",
        runId: "run-1",
        stepId: "step-1",
        message: "Thinking before the first tool.",
        durationMs: null,
        createdAt: "2026-02-15T10:00:02.000Z"
      },
      {
        type: "tool_call" as const,
        key: "tool-1",
        runId: "run-1",
        toolCallId: "tool-1",
        toolCall: buildToolCall({ id: "tool-1", run_id: "run-1" }),
        createdAt: "2026-02-15T10:00:01.000Z"
      },
      {
        type: "reasoning_step" as const,
        key: "step-2:reasoning",
        runId: "run-1",
        stepId: "step-2",
        message: "Thinking after the tool.",
        durationMs: null,
        createdAt: "2026-02-15T10:00:03.000Z"
      }
    ];

    const items = buildLiveRunActivityItems(
      [buildRun({ id: "run-1", status: "running", tool_calls: [], steps: [] })],
      () => ({ steps: [], toolCalls: [] }),
      { "run-1": ledger }
    );

    expect(items.map((item) => item.key)).toEqual([
      "run-1:step-1:reasoning",
      "run-1:tool-1",
      "run-1:step-2:reasoning"
    ]);
  });

  it("updates an existing live ledger row instead of duplicating it", () => {
    const initial = appendLiveActivityLedgerItem([], {
      type: "tool_call",
      key: "tool-1",
      runId: "run-1",
      toolCallId: "tool-1",
      toolCall: buildToolCall({ id: "tool-1", status: "running" }),
      createdAt: "2026-02-15T10:00:01.000Z"
    });
    const updated = appendLiveActivityLedgerItem(initial, {
      type: "tool_call",
      key: "tool-1",
      runId: "run-1",
      toolCallId: "tool-1",
      toolCall: buildToolCall({ id: "tool-1", status: "ok" }),
      createdAt: "2026-02-15T10:00:05.000Z"
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ toolCallId: "tool-1", toolCall: { status: "ok" } });
    expect(updated[0]).toMatchObject({ createdAt: "2026-02-15T10:00:01.000Z" });
  });

  it("keeps live ledger order stable when an earlier tool finishes after a later tool starts", () => {
    const first = appendLiveActivityLedgerItem([], {
      type: "tool_call",
      key: "tool-1",
      runId: "run-1",
      toolCallId: "tool-1",
      toolCall: buildToolCall({ id: "tool-1", status: "running", started_at: "2026-02-15T10:00:01.000Z" }),
      createdAt: "2026-02-15T10:00:01.000Z"
    });
    const second = appendLiveActivityLedgerItem(first, {
      type: "tool_call",
      key: "tool-2",
      runId: "run-1",
      toolCallId: "tool-2",
      toolCall: buildToolCall({ id: "tool-2", status: "running", started_at: "2026-02-15T10:00:02.000Z" }),
      createdAt: "2026-02-15T10:00:02.000Z"
    });
    const finishedFirst = appendLiveActivityLedgerItem(second, {
      type: "tool_call",
      key: "tool-1",
      runId: "run-1",
      toolCallId: "tool-1",
      toolCall: buildToolCall({
        id: "tool-1",
        status: "ok",
        started_at: "2026-02-15T10:00:01.000Z",
        completed_at: "2026-02-15T10:00:05.000Z"
      }),
      createdAt: "2026-02-15T10:00:05.000Z"
    });

    expect(finishedFirst.map((item) => item.type === "tool_call" && item.toolCallId)).toEqual(["tool-1", "tool-2"]);
    expect(finishedFirst[0]).toMatchObject({ createdAt: "2026-02-15T10:00:01.000Z", toolCall: { status: "ok" } });
  });

  it("builds a flat live tool timeline without step projections", () => {
    const timeline = buildLiveRunTimelineFromToolCalls([
      buildToolCall({ id: "tool-1", step_id: "step-a" }),
      buildToolCall({ id: "tool-2", step_id: "step-b" })
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline.every((item) => item.type === "tool_call")).toBe(true);
  });

  it("reconciles ledger tool rows with the latest merged tool snapshots", () => {
    const reconciled = reconcileLiveActivityLedgerToolCalls(
      [
        {
          type: "tool_call",
          key: "tool-1",
          runId: "run-1",
          toolCallId: "tool-1",
          toolCall: buildToolCall({ id: "tool-1", status: "running", output_text: null }),
          createdAt: "2026-02-15T10:00:01.000Z"
        }
      ],
      [buildToolCall({ id: "tool-1", status: "ok", output_text: "done" })]
    );

    expect(reconciled[0]).toMatchObject({
      createdAt: "2026-02-15T10:00:01.000Z",
      toolCall: { id: "tool-1", status: "ok", output_text: "done" }
    });
  });

  it("preserves hydrated payloads when a later compact snapshot arrives", () => {
    const merged = mergeRunToolCalls(
      [
        buildToolCall({
          id: "tool-1",
          status: "running",
          has_full_payload: true,
          arguments_json: { entity_name: "ACME" },
          result_content_json: { status: "ok", proposal_id: "proposal-1" },
          output_text: "OK\nproposal_id: proposal-1"
        })
      ],
      [
        buildToolCall({
          id: "tool-1",
          status: "ok",
          has_full_payload: false,
          arguments_json: null,
          result_content_json: null,
          output_text: null
        })
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "tool-1",
      status: "ok",
      has_full_payload: true,
      arguments_json: { entity_name: "ACME" },
      result_content_json: { status: "ok", proposal_id: "proposal-1" },
      output_text: "OK\nproposal_id: proposal-1"
    });
  });

  it("indexes runs by id and separates pending runs", () => {
    const threadDetail: AgentThreadDetail = {
      thread: {
        id: "thread-1",
        title: "Thread",
        created_at: "2026-02-15T10:00:00Z",
        updated_at: "2026-02-15T10:05:00Z"
      },
      turns: [
        buildTurn({
          run_id: "run-a",
          turn_index: 0,
          assistant_message: buildTurn().assistant_message
        }),
        buildTurn({
          run_id: "run-b",
          turn_index: 1,
          assistant_message: null
        })
      ],
      configured_model_name: "gpt-test",
      current_context_tokens: 42,
      runs: [
        buildRun({ id: "run-a", turn_index: 0, created_at: "2026-02-15T10:01:00Z" }),
        buildRun({ id: "run-b", turn_index: 1, created_at: "2026-02-15T10:02:00Z", status: "running" }),
        buildRun({ id: "run-c", turn_index: 2, created_at: "2026-02-15T10:03:00Z", status: "running" })
      ]
    };

    expect(runById(threadDetail).get("run-a")?.id).toBe("run-a");
    expect(pendingRuns(threadDetail).map((run) => run.id)).toEqual(["run-b", "run-c"]);
  });

  it("aggregates metrics and change-type counts", () => {
    const runs = [
      buildRun({ id: "run-1", input_tokens: 10, output_tokens: 20, total_cost_usd: 0.001 }),
      buildRun({ id: "run-2", input_tokens: 15, output_tokens: 40, total_cost_usd: 0.002 }),
      buildRun({ id: "run-3", input_tokens: null, output_tokens: null, total_cost_usd: null })
    ];
    expect(totalRunMetric(runs, "input_tokens")).toBe(25);
    expect(totalRunMetric(runs, "total_cost_usd")).toBe(0.003);

    const none = [buildRun({ id: "run-4", input_tokens: null })];
    expect(totalRunMetric(none, "input_tokens")).toBeNull();
    expect(latestRunMetric(none, "input_tokens")).toBeNull();
    expect(latestRunMetric(runs, "input_tokens")).toBe(15);

    expect(
      buildThreadUsageTotals({
        thread: {
          id: "thread-1",
          title: "Thread",
          created_at: "2026-02-15T10:00:00Z",
          updated_at: "2026-02-15T10:05:00Z"
        },
        turns: [],
        runs,
        configured_model_name: "gpt-test",
        current_context_tokens: 88
      })
    ).toEqual({
      context: 88,
      input: 25,
      output: 60,
      cacheRead: 0,
      totalCost: 0.003
    });

    const changeSummary = summarizeRunChangeTypes([
      buildChangeItem({ id: "change-1", change_type: "create_entry" }),
      buildChangeItem({ id: "change-2", change_type: "update_entry" }),
      buildChangeItem({ id: "change-3", change_type: "create_group_member" }),
      buildChangeItem({ id: "change-4", change_type: "create_tag" }),
      buildChangeItem({ id: "change-5", change_type: "delete_entity" })
    ]);

    expect(changeSummary).toEqual({ entryCount: 2, groupCount: 1, tagCount: 1, entityCount: 1 });
  });

  it("sorts runs in chronological order", () => {
    const sorted = sortRunsByCreatedAt([
      buildRun({ id: "run-late", created_at: "2026-02-15T10:02:00Z" }),
      buildRun({ id: "run-early", created_at: "2026-02-15T10:01:00Z" })
    ]);

    expect(sorted.map((run) => run.id)).toEqual(["run-early", "run-late"]);
  });

  it("recomputes current context from newest running run with tokens", () => {
    const runs = [
      buildRun({
        id: "old",
        created_at: "2026-02-15T10:01:00Z",
        status: "completed",
        context_tokens: 100
      }),
      buildRun({
        id: "running",
        created_at: "2026-02-15T10:02:00Z",
        status: "running",
        context_tokens: 999
      })
    ];
    expect(recomputeThreadCurrentContextTokens(runs)).toBe(999);
  });
});
