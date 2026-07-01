import { describe, expect, it } from "vitest";

import { agentStreamSession } from "./agentStreamSession";
import { findRunningRunForThread, resolveLiveRunIdForThread, resolveReconnectSequenceIndex } from "./liveRun";
import { buildRun, buildRunEvent } from "../../../test/factories/agent";

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
});
