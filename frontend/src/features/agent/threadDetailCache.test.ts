import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { listOrEmpty } from "../../lib/collections";
import { queryKeys } from "../../lib/queryKeys";
import type { AgentThreadDetail } from "../../lib/types";
import { buildRun, buildTurn } from "../../test/factories/agent";
import { patchAgentThreadCacheFromStreamEvent } from "./threadDetailCache";

function buildThreadDetail(): AgentThreadDetail {
  const turn = buildTurn({
    run_id: "run-1",
    assistant_message: null,
    status: "running"
  });
  const run = buildRun({
    id: "run-1",
    status: "running",
    final_assistant_reply: null,
    steps: [],
    tool_calls: []
  });
  return {
    thread: {
      id: "thread-1",
      title: "Test",
      created_at: "2026-02-15T10:00:00Z",
      updated_at: "2026-02-15T10:00:00Z",
      initiated_by_external_agent: false
    },
    turns: [turn],
    runs: [run],
    configured_model_name: "gpt-test",
    current_context_tokens: 10
  };
}

describe("patchAgentThreadCacheFromStreamEvent", () => {
  it("persists tool calls and final assistant content from stream events", () => {
    const queryClient = new QueryClient();
    const threadId = "thread-1";
    queryClient.setQueryData(queryKeys.agent.thread(threadId), buildThreadDetail());

    patchAgentThreadCacheFromStreamEvent(queryClient, threadId, {
      type: "tool_started",
      run_id: "run-1",
      step_index: 1,
      tool_call_id: "tool-1",
      tool_name: "run_bh",
      display_label: "bh tags list",
      display_detail: "bh tags list"
    });
    patchAgentThreadCacheFromStreamEvent(queryClient, threadId, {
      type: "tool_finished",
      run_id: "run-1",
      step_index: 1,
      tool_call_id: "tool-1",
      tool_name: "run_bh",
      status: "ok",
      display_label: "bh tags list",
      display_detail: "bh tags list"
    });
    patchAgentThreadCacheFromStreamEvent(queryClient, threadId, {
      type: "run_finished",
      run_id: "run-1",
      status: "completed",
      final_assistant_content: "All set."
    });

    const detail = queryClient.getQueryData<AgentThreadDetail>(queryKeys.agent.thread(threadId));
    expect(listOrEmpty(detail?.runs[0]?.tool_calls)).toHaveLength(1);
    expect(listOrEmpty(detail?.runs[0]?.tool_calls)[0]?.tool_name).toBe("run_bh");
    expect(listOrEmpty(detail?.runs[0]?.tool_calls)[0]?.display_label).toBe("bh tags list");
    expect(listOrEmpty(detail?.runs[0]?.tool_calls)[0]?.display_detail).toBe("bh tags list");
    expect(listOrEmpty(detail?.runs[0]?.tool_calls)[0]?.status).toBe("ok");
    expect(detail?.runs[0].status).toBe("completed");
    expect(detail?.runs[0].final_assistant_reply).toBe("All set.");
    expect(detail?.turns[0].assistant_message?.content_markdown).toBe("All set.");
  });

  it("persists committed reasoning on run steps from model_decision_committed", () => {
    const queryClient = new QueryClient();
    const threadId = "thread-1";
    queryClient.setQueryData(queryKeys.agent.thread(threadId), buildThreadDetail());

    patchAgentThreadCacheFromStreamEvent(queryClient, threadId, {
      type: "model_decision_committed",
      run_id: "run-1",
      step_index: 1,
      assistant_message_id: "assistant-msg-1",
      has_tool_requests: true,
      reasoning_text: "Checking accounts before listing entries."
    });

    const detail = queryClient.getQueryData<AgentThreadDetail>(queryKeys.agent.thread(threadId));
    expect(listOrEmpty(detail?.runs[0]?.steps)).toHaveLength(1);
    expect(listOrEmpty(detail?.runs[0]?.steps)[0]).toMatchObject({
      id: "assistant-msg-1",
      reasoning_text: "Checking accounts before listing entries."
    });
  });
});
