import { useCallback, useState, useSyncExternalStore } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAgentToolCall } from "../../lib/api";
import { buildRun, buildStep, buildToolCall } from "../../test/factories/agent";
import type { AgentToolCall } from "../../lib/types";
import { mergeRunToolCalls, type RunActivityItem } from "./activity";
import { AssistantMessageRunWork } from "./AssistantMessageRunWork";
import {
  getAgentStreamSessionRevision,
  getAgentStreamSessionSnapshot,
  resetAgentStreamSession,
  setAgentStreamSessionOptimisticToolCalls,
  subscribeAgentStreamSession
} from "./panel/agentStreamSession";

vi.mock("../../lib/api", () => ({
  getAgentToolCall: vi.fn()
}));

function buildCompactBhToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return buildToolCall({
    id: "tool-bh-list",
    run_id: "run-reopen",
    step_id: "step-1",
    tool_name: "run_bh",
    display_label: "bh entities list",
    has_full_payload: false,
    arguments_json: null,
    result_content_json: null,
    output_text: null,
    status: "ok",
    ...overrides
  });
}

function HydratingAssistantRunWork({
  runs,
  liveActivityLedgerByRunId
}: {
  runs: ReturnType<typeof buildRun>[];
  liveActivityLedgerByRunId?: Record<string, RunActivityItem[]>;
}) {
  useSyncExternalStore(subscribeAgentStreamSession, getAgentStreamSessionRevision, getAgentStreamSessionRevision);
  const session = getAgentStreamSessionSnapshot();
  const [hydratingToolCallIds, setHydratingToolCallIds] = useState<ReadonlySet<string>>(() => new Set());

  const handleHydrateToolCall = useCallback(async (runId: string, toolCallId: string) => {
    if (hydratingToolCallIds.has(toolCallId)) {
      return;
    }
    setHydratingToolCallIds((current) => new Set(current).add(toolCallId));
    try {
      const toolCall = await getAgentToolCall(toolCallId);
      const existing = mergeRunToolCalls([], [toolCall]);
      setAgentStreamSessionOptimisticToolCalls(runId, existing);
    } finally {
      setHydratingToolCallIds((current) => {
        if (!current.has(toolCallId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(toolCallId);
        return next;
      });
    }
  }, [hydratingToolCallIds]);

  return (
    <AssistantMessageRunWork
      runs={runs}
      optimisticStepsByRunId={session.optimisticStepsByRunId}
      optimisticToolCallsByRunId={session.optimisticToolCallsByRunId}
      liveActivityLedgerByRunId={liveActivityLedgerByRunId}
      onHydrateToolCall={(runId, toolCallId) => {
        void handleHydrateToolCall(runId, toolCallId);
      }}
      hydratingToolCallIds={hydratingToolCallIds}
    />
  );
}

describe("AssistantMessageRunWork", () => {
  beforeEach(() => {
    resetAgentStreamSession();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetAgentStreamSession();
  });

  it("hydrates compact persisted tool calls after reopening a completed turn", async () => {
    const compactToolCall = buildCompactBhToolCall();
    const hydratedToolCall = buildToolCall({
      id: compactToolCall.id,
      run_id: compactToolCall.run_id,
      step_id: compactToolCall.step_id,
      tool_name: "run_bh",
      display_label: "bh entities list",
      has_full_payload: true,
      arguments_json: { argv: ["entities", "list"] },
      result_content_json: { status: "ok" },
      output_text: "OK\nlisted entities",
      status: "ok"
    });
    const run = buildRun({
      id: "run-reopen",
      status: "completed",
      steps: [buildStep({ id: "step-1", run_id: "run-reopen", step_index: 1 })],
      tool_calls: [compactToolCall]
    });

    vi.mocked(getAgentToolCall).mockResolvedValue(hydratedToolCall);

    render(<HydratingAssistantRunWork runs={[run]} />);

    await userEvent.click(screen.getByRole("button", { name: /Worked for 1 second, 1 tool call/i }));
    await userEvent.click(screen.getByText("bh entities list"));

    await waitFor(() => expect(getAgentToolCall).toHaveBeenCalledWith("tool-bh-list"));
    await waitFor(() => expect(screen.getByText("Arguments")).toBeInTheDocument());
    expect(screen.getByText(/"argv"/)).toBeInTheDocument();
    expect(screen.queryByText("Loading on demand...")).not.toBeInTheDocument();
  });

  it("reads hydrated snapshots from the stream session when parent optimistic props stay empty", async () => {
    const compactToolCall = buildCompactBhToolCall();
    const hydratedToolCall = buildToolCall({
      id: compactToolCall.id,
      run_id: compactToolCall.run_id,
      step_id: compactToolCall.step_id,
      tool_name: "run_bh",
      display_label: "bh entities list",
      has_full_payload: true,
      arguments_json: { argv: ["entities", "list"] },
      result_content_json: { status: "ok" },
      output_text: "OK\nlisted entities",
      status: "ok"
    });
    const run = buildRun({
      id: "run-reopen",
      status: "completed",
      steps: [buildStep({ id: "step-1", run_id: "run-reopen", step_index: 1 })],
      tool_calls: [compactToolCall]
    });

    vi.mocked(getAgentToolCall).mockResolvedValue(hydratedToolCall);

    render(
      <AssistantMessageRunWork
        runs={[run]}
        optimisticStepsByRunId={{}}
        optimisticToolCallsByRunId={{}}
        onHydrateToolCall={(runId, toolCallId) => {
          void getAgentToolCall(toolCallId).then((toolCall) => {
            setAgentStreamSessionOptimisticToolCalls(runId, [toolCall]);
          });
        }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Worked for 1 second, 1 tool call/i }));
    await userEvent.click(screen.getByText("bh entities list"));

    await waitFor(() => expect(getAgentToolCall).toHaveBeenCalledWith("tool-bh-list"));
    await waitFor(() => expect(screen.getByText("Arguments")).toBeInTheDocument());
    expect(screen.queryByText("Loading on demand...")).not.toBeInTheDocument();
  });

  it("hydrates compact ledger rows for a completed run with a stale live ledger", async () => {
    const compactToolCall = buildCompactBhToolCall();
    const hydratedToolCall = buildToolCall({
      id: compactToolCall.id,
      run_id: compactToolCall.run_id,
      step_id: compactToolCall.step_id,
      tool_name: "run_bh",
      display_label: "bh entities list",
      has_full_payload: true,
      arguments_json: { argv: ["entities", "list"] },
      result_content_json: { status: "ok" },
      output_text: "OK\nlisted entities",
      status: "ok"
    });
    const run = buildRun({
      id: "run-reopen",
      status: "completed",
      steps: [],
      tool_calls: [compactToolCall]
    });
    const liveActivityLedgerByRunId = {
      [run.id]: [
        {
          type: "tool_call" as const,
          key: compactToolCall.id,
          runId: run.id,
          toolCallId: compactToolCall.id,
          toolCall: compactToolCall,
          createdAt: "2026-02-15T10:00:01.000Z"
        }
      ]
    };

    vi.mocked(getAgentToolCall).mockResolvedValue(hydratedToolCall);

    render(<HydratingAssistantRunWork runs={[run]} liveActivityLedgerByRunId={liveActivityLedgerByRunId} />);

    await userEvent.click(screen.getByRole("button", { name: /Worked for 1 second, 1 tool call/i }));
    await userEvent.click(screen.getByText("bh entities list"));

    await waitFor(() => expect(getAgentToolCall).toHaveBeenCalledWith("tool-bh-list"));
    await waitFor(() => expect(screen.getByText("Arguments")).toBeInTheDocument());
    expect(screen.queryByText("Loading on demand...")).not.toBeInTheDocument();
  });
});
