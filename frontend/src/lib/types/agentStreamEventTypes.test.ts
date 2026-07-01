/**
 * CALLING SPEC:
 * - Purpose: assert frontend SSE union literals stay internally consistent.
 * - Inputs: KNOWN_AGENT_STREAM_EVENT_TYPES and explicit AgentStreamEvent union members.
 * - Outputs: vitest assertions that fail when the hand-written union drifts internally.
 * - Side effects: none.
 *
 * Cross-repo backend parity is enforced by `scripts/check_sse_parity.py`.
 */
import { describe, expect, it } from "vitest";

import { KNOWN_AGENT_STREAM_EVENT_TYPES, type AgentStreamEvent } from "./agent";

/** Ephemeral model streaming plus legacy model_client delta aliases still parsed on the wire. */
const FRONTEND_SSE_EXTRA_EVENT_TYPES = ["model_delta", "reasoning_delta", "text_delta"] as const;

describe("AgentStreamEvent type parity", () => {
  it("lists each union member exactly once", () => {
    const unionTypes: AgentStreamEvent["type"][] = [
      "reasoning_delta",
      "text_delta",
      "model_delta",
      "run_started",
      "model_request_started",
      "model_decision_committed",
      "tool_started",
      "tool_finished",
      "step_committed",
      "run_finished"
    ];
    expect([...KNOWN_AGENT_STREAM_EVENT_TYPES].sort()).toEqual([...unionTypes].sort());
  });

  it("includes wire-only delta aliases", () => {
    for (const extraType of FRONTEND_SSE_EXTRA_EVENT_TYPES) {
      expect(KNOWN_AGENT_STREAM_EVENT_TYPES).toContain(extraType);
    }
  });
});
