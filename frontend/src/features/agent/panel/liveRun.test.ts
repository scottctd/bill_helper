import { describe, expect, it } from "vitest";

import { agentStreamSession } from "./agentStreamSession";
import {
  findRunningRunForThread,
  isRunStreamActive,
  resolveLiveRunIdForThread,
  resolveReconnectSequenceIndex,
  shouldShowRunChangeSummary
} from "./liveRun";
import { buildChangeItem, buildRun, buildRunEvent } from "../../../test/factories/agent";

describe("liveRun helpers", () => {
  it("prefers mapped stream run id for a thread", () => {
    const runs = [buildRun({ id: "run-1", status: "running" })];
    const session = {
      ...agentStreamSession,
      activeStreamRunIdsByThreadId: { "thread-1": "run-1" }
    };

    expect(resolveLiveRunIdForThread("thread-1", runs, session)).toBe("run-1");
  });

  it("falls back to running run with live buffers", () => {
    const runs = [buildRun({ id: "run-2", status: "running" })];
    const session = {
      ...agentStreamSession,
      activeStreamRunIdsByThreadId: {},
      streamedReasoningTextByRunId: { "run-2": "Checking entities" }
    };

    expect(resolveLiveRunIdForThread("thread-1", runs, session)).toBe("run-2");
  });

  it("finds the latest running run", () => {
    const runs = [
      buildRun({ id: "run-1", status: "completed" }),
      buildRun({ id: "run-2", status: "running" })
    ];

    expect(findRunningRunForThread(runs)?.id).toBe("run-2");
  });

  it("uses the max persisted or session sequence index for reconnect", () => {
    const run = buildRun({
      id: "run-3",
      status: "running",
      events: [buildRunEvent({ run_id: "run-3", sequence_index: 4 })]
    });
    const session = {
      ...agentStreamSession,
      lastSequenceIndexByRunId: { "run-3": 7 }
    };

    expect(resolveReconnectSequenceIndex(run, session)).toBe(7);
  });

  it("treats running runs and active stream buffers as live", () => {
    const running = buildRun({ id: "run-running", status: "running" });
    const completed = buildRun({ id: "run-completed", status: "completed" });

    expect(isRunStreamActive(running)).toBe(true);
    expect(
      isRunStreamActive(completed, {
        activeStreamRunId: "run-completed",
        streamedTextByRunId: { "run-completed": "Still landing..." }
      })
    ).toBe(true);
    expect(isRunStreamActive(completed)).toBe(false);
  });

  it("gates change summaries until streaming finishes and the assistant reply is visible", () => {
    const running = buildRun({
      id: "run-running",
      status: "running",
      change_items: [buildChangeItem({ id: "change-1" })]
    });
    const completed = buildRun({
      id: "run-completed",
      status: "completed",
      final_assistant_reply: "Done.",
      change_items: [buildChangeItem({ id: "change-1" })]
    });

    expect(
      shouldShowRunChangeSummary(running, 1, {
        isStreamActive: true,
        hasVisibleAssistantMessage: false
      })
    ).toBe(false);
    expect(
      shouldShowRunChangeSummary(completed, 1, {
        isStreamActive: false,
        hasVisibleAssistantMessage: true
      })
    ).toBe(true);
    expect(
      shouldShowRunChangeSummary(completed, 1, {
        isStreamActive: false,
        hasVisibleAssistantMessage: false
      })
    ).toBe(true);
  });
});
