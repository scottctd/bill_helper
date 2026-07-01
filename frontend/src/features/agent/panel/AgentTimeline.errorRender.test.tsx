import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildRun, buildTurn } from "../../../test/factories/agent";
import { AgentTimeline } from "./AgentTimeline";
import type { AgentTimelineModel } from "./agentTimelineModel";

function buildTimelineModel(overrides: Partial<AgentTimelineModel> = {}): AgentTimelineModel {
  return {
    selectedThreadId: "thread-1",
    isLoading: false,
    errorMessage: null,
    initiatedByExternalAgent: false,
    turns: [],
    runsById: new Map(),
    pendingAssistantRuns: [],
    pendingUserMessage: null,
    pendingAssistantMessage: null,
    shouldShowOptimisticAssistantBubble: false,
    pendingRunAttachedToOptimisticMessage: null,
    stream: {
      activeStreamRunId: null,
      activeStreamReasoningText: "",
      activeStreamText: "",
      streamedReasoningTextByRunId: {},
      streamedTextByRunId: {},
      optimisticStepsByRunId: {},
      optimisticToolCallsByRunId: {},
      liveActivityLedgerByRunId: {},
      activeOptimisticSteps: [],
      activeOptimisticToolCalls: [],
      hydratingToolCallIds: new Set<string>()
    },
    scroll: {
      timelineScrollRef: createRef<HTMLDivElement>(),
      detachFromBottom: () => undefined,
      isAtBottom: true,
      scrollToBottom: () => undefined
    },
    onHydrateToolCall: () => undefined,
    ...overrides
  };
}

describe("AgentTimeline error rendering", () => {
  it("renders standalone run errors for pending turns without assistant replies", () => {
    const turn = buildTurn({
      run_id: "run-error",
      user_message: {
        ...buildTurn().user_message,
        content_markdown: "Please retry."
      },
      assistant_message: null
    });
    const run = buildRun({
      id: "run-error",
      status: "failed",
      error_detail: "Provider timeout while calling the model."
    });

    render(
      <AgentTimeline
        model={buildTimelineModel({
          turns: [turn],
          runsById: new Map([[run.id, run]]),
          pendingAssistantRuns: [run]
        })}
      />
    );

    expect(screen.getByText(/Provider timeout while calling the model\./)).toBeInTheDocument();
  });
});
