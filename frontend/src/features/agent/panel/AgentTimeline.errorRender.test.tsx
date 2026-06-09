import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildRun, buildTurn } from "../../../test/factories/agent";
import { AgentTimeline } from "./AgentTimeline";

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
        selectedThreadId="thread-1"
        isLoading={false}
        errorMessage={null}
        initiatedByExternalAgent={false}
        turns={[turn]}
        timelineScrollRef={createRef<HTMLDivElement>()}
        runsById={new Map([[run.id, run]])}
        pendingAssistantRuns={[run]}
        pendingUserMessage={null}
        pendingAssistantMessage={null}
        shouldShowOptimisticAssistantBubble={false}
        pendingRunAttachedToOptimisticMessage={null}
        activeStreamRunId={null}
        activeStreamReasoningText=""
        activeStreamText=""
        streamedReasoningTextByRunId={{}}
        streamedTextByRunId={{}}
        optimisticStepsByRunId={{}}
        optimisticToolCallsByRunId={{}}
        liveActivityLedgerByRunId={{}}
        activeOptimisticSteps={[]}
        activeOptimisticToolCalls={[]}
        detachFromBottom={() => undefined}
        onHydrateToolCall={() => undefined}
        hydratingToolCallIds={new Set<string>()}
        isAtBottom
        scrollToBottom={() => undefined}
      />
    );

    expect(screen.getByText(/Provider timeout while calling the model\./)).toBeInTheDocument();
  });
});
