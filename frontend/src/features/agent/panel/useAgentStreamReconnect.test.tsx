import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentThreadDetail } from "../../../lib/types";
import { agentStreamAbortControllers } from "./agentStreamSession";
import { useAgentStreamReconnect } from "./useAgentStreamReconnect";
import { buildRun } from "../../../test/factories/agent";

const streamAgentRun = vi.fn();
const getAgentThread = vi.fn();

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    streamAgentRun: (...args: unknown[]) => streamAgentRun(...args),
    getAgentThread: (...args: unknown[]) => getAgentThread(...args)
  };
});

function buildThreadDetail(overrides: Partial<AgentThreadDetail> = {}): AgentThreadDetail {
  return {
    thread: {
      id: "thread-1",
      title: "Test thread",
      owner_user_id: "user-1",
      created_at: "2026-02-15T10:00:00Z",
      updated_at: "2026-02-15T10:00:00Z",
      configured_model_name: "gpt-test",
      initiated_by_external_agent: false
    },
    messages: [],
    runs: overrides.runs ?? [buildRun({ id: "run-1", status: "running", events: [] })],
    current_context_tokens: 10,
    ...overrides
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAgentStreamReconnect", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.keys(agentStreamAbortControllers).forEach((threadId) => {
      delete agentStreamAbortControllers[threadId];
    });
  });

  it("subscribes to a running run after thread detail loads", async () => {
    streamAgentRun.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({
        type: "text_delta",
        run_id: "run-1",
        delta: "Done"
      });
    });
    getAgentThread.mockResolvedValue(buildThreadDetail());

    const queryClient = new QueryClient();
    renderHook(
      () =>
        useAgentStreamReconnect({
          clearOptimisticThreadTitle: vi.fn(),
          getReconnectSequenceIndex: () => 0,
          handleAgentStreamEvent: vi.fn(),
          removeOptimisticRunningThreadId: vi.fn(),
          resetOptimisticRunState: vi.fn(),
          selectedThreadId: "thread-1",
          setThreadStreamHealthy: vi.fn(),
          threadDetail: buildThreadDetail()
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(streamAgentRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          afterSequence: 0
        })
      );
    });
  });

  it("does not reconnect when the thread already owns an active stream controller", async () => {
    agentStreamAbortControllers["thread-1"] = new AbortController();

    renderHook(
      () =>
        useAgentStreamReconnect({
          clearOptimisticThreadTitle: vi.fn(),
          getReconnectSequenceIndex: () => 0,
          handleAgentStreamEvent: vi.fn(),
          removeOptimisticRunningThreadId: vi.fn(),
          resetOptimisticRunState: vi.fn(),
          selectedThreadId: "thread-1",
          setThreadStreamHealthy: vi.fn(),
          threadDetail: buildThreadDetail()
        }),
      { wrapper: createWrapper(new QueryClient()) }
    );

    await waitFor(() => {
      expect(streamAgentRun).not.toHaveBeenCalled();
    });
  });
});
