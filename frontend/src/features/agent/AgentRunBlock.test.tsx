import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentRunBlock } from "./AgentRunBlock";
import type { RunActivityItem } from "./activity";
import { buildChangeItem, buildRun, buildStep, buildToolCall } from "../../test/factories/agent";

describe("AgentRunBlock", () => {
  it("renders summary mode without a per-run review button", () => {
    const run = buildRun({
      id: "run-summary",
      change_items: [buildChangeItem({ id: "change-1", status: "PENDING_REVIEW", change_type: "create_entry" })]
    });

    render(<AgentRunBlock run={run} mode="summary" />);

    expect(screen.getByText("1 proposed changes pending review")).toBeInTheDocument();
    expect(screen.getByText("Use the thread header Review button to process proposals.")).toBeInTheDocument();
  });

  it("renders interleaved activity timeline for progress notes", () => {
    const toolCall = buildToolCall({ id: "tool-1", step_id: "step-1", tool_name: "list_entries" });
    const run = buildRun({
      id: "run-activity",
      status: "running",
      steps: [
        buildStep({
          id: "step-1",
          step_index: 1,
          progress_note: "Validating candidate entries"
        })
      ],
      tool_calls: [toolCall]
    });

    render(<AgentRunBlock run={run} mode="activity" />);

    expect(screen.getAllByText("Validating candidate entries").length).toBeGreaterThanOrEqual(1);
  });

  it("collapses model reasoning segments with duration and token summary", async () => {
    const run = buildRun({
      id: "run-model-reasoning",
      status: "running",
      steps: [
        buildStep({
          id: "step-1",
          step_index: 1,
          reasoning_text: "Checking entities before proposing changes.",
          reasoning_duration_ms: 3200
        })
      ]
    });

    render(<AgentRunBlock run={run} mode="activity" />);

    expect(screen.getByText("Thought for 4s · 11 tokens")).toBeInTheDocument();
    expect(screen.queryByText("Checking entities before proposing changes.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Thought for 4s · 11 tokens"));

    expect(screen.getByText("Checking entities before proposing changes.")).toBeInTheDocument();
  });

  it("renders model-visible tool output in tool-call details", async () => {
    const toolCall = buildToolCall({
      id: "tool-1",
      step_id: "step-1",
      tool_name: "list_entries",
      display_label: "Listed entries",
      output_text: "OK\nsummary: returned 2 of 2 matching entries",
      result_content_json: { status: "ok", summary: "returned 2 of 2 matching entries" }
    });
    const run = buildRun({
      id: "run-tool-output",
      status: "completed",
      steps: [buildStep({ id: "step-1", step_index: 1 })],
      tool_calls: [toolCall]
    });

    render(<AgentRunBlock run={run} mode="activity" />);

    await userEvent.click(screen.getByRole("button", { name: /Worked for/i }));
    await userEvent.click(screen.getByText("Listed entries"));

    expect(screen.getByText("Model-visible tool result")).toBeInTheDocument();
    expect(screen.getByText(/OK\s+summary: returned 2 of 2 matching entries/i)).toBeInTheDocument();
    expect(screen.getByText("Structured output (debug)")).toBeInTheDocument();
  });

  it("renders placeholder tool rows from optimistic tool snapshots", async () => {
    const optimisticToolCall = buildToolCall({
      id: "tool-1",
      step_id: "step-1",
      tool_name: "list_tags",
      display_label: "Listed tags",
      arguments_json: { include_descriptions: true }
    });
    const run = buildRun({
      id: "run-optimistic",
      status: "running",
      steps: []
    });

    render(
      <AgentRunBlock
        run={run}
        mode="activity"
        optimisticToolCalls={[optimisticToolCall]}
      />
    );

    await userEvent.click(screen.getByText("Listed tags"));

    expect(screen.queryByText("Waiting for tool snapshot...")).not.toBeInTheDocument();
    expect(screen.getByText("Arguments")).toBeInTheDocument();
  });

  it("hydrates compact tool call payloads when the row is expanded", async () => {
    const onHydrateToolCall = vi.fn();
    const onInspectActivity = vi.fn();
    const toolCall = buildToolCall({
      id: "tool-compact",
      run_id: "run-compact",
      step_id: "step-1",
      tool_name: "list_tags",
      display_label: "Listed tags",
      has_full_payload: false,
      arguments_json: null,
      result_content_json: null,
      output_text: null
    });
    const run = buildRun({
      id: "run-compact",
      status: "running",
      steps: [buildStep({ id: "step-1", run_id: "run-compact", step_index: 1 })],
      tool_calls: [toolCall]
    });

    render(
      <AgentRunBlock
        run={run}
        onInspectActivity={onInspectActivity}
        onHydrateToolCall={onHydrateToolCall}
        mode="activity"
      />
    );

    await userEvent.click(screen.getByText("Listed tags"));

    expect(onInspectActivity).toHaveBeenCalled();
    expect(onHydrateToolCall).toHaveBeenCalledWith("run-compact", "tool-compact");
    expect(screen.getByText("Tool details")).toBeInTheDocument();
  });

  it("renders streamed compact tool display labels before hydration", async () => {
    const compactToolCall = buildToolCall({
      id: "tool-streamed-compact",
      run_id: "run-streamed-compact",
      step_id: "step-1",
      tool_name: "propose_create_entity",
      display_label: "Proposed entity creation",
      has_full_payload: false,
      arguments_json: null,
      result_content_json: null,
      output_text: null,
      status: "queued"
    });
    const run = buildRun({
      id: "run-streamed-compact",
      status: "running",
      steps: []
    });

    render(
      <AgentRunBlock
        run={run}
        mode="activity"
        optimisticToolCalls={[compactToolCall]}
      />
    );

    expect(screen.getByText("Proposed entity creation")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Proposed entity creation"));

    expect(screen.getByText("Tool details")).toBeInTheDocument();
    expect(screen.getByText("Loading on demand...")).toBeInTheDocument();
  });

  it("keeps live assistant text anchored before following tool rows", () => {
    const toolCall = buildToolCall({
      id: "tool-after-message",
      run_id: "run-live-ledger",
      step_id: "step-1",
      tool_name: "rename_thread",
      display_label: "Renamed thread",
      status: "running"
    });
    const liveActivity: RunActivityItem[] = [
      {
        type: "reasoning_step",
        key: "step-1:reasoning",
        runId: "run-live-ledger",
        stepId: "step-1",
        message: "Deciding the title.",
        durationMs: 1000,
        createdAt: "2026-02-15T10:00:00Z"
      },
      {
        type: "assistant_message",
        key: "step-1:assistant",
        runId: "run-live-ledger",
        stepId: "step-1",
        message: "I will rename the thread first.",
        createdAt: "2026-02-15T10:00:00Z"
      },
      {
        type: "tool_call",
        key: toolCall.id,
        runId: "run-live-ledger",
        toolCallId: toolCall.id,
        toolCall,
        createdAt: "2026-02-15T10:00:01Z"
      }
    ];
    const run = buildRun({
      id: "run-live-ledger",
      status: "running",
      final_assistant_reply: null
    });

    render(<AgentRunBlock run={run} mode="activity" liveActivityLedgerByRunId={{ [run.id]: liveActivity }} />);

    const timelineText = document.querySelector(".agent-run-activity-timeline")?.textContent ?? "";
    expect(timelineText.indexOf("Thought")).toBeGreaterThanOrEqual(0);
    expect(timelineText.indexOf("I will rename the thread first.")).toBeGreaterThan(timelineText.indexOf("Thought"));
    expect(timelineText.indexOf("Renamed thread")).toBeGreaterThan(
      timelineText.indexOf("I will rename the thread first.")
    );
  });

  it("renders a live reasoning placeholder as soon as the run starts", () => {
    const run = buildRun({
      id: "run-started",
      status: "running",
      steps: []
    });

    render(<AgentRunBlock run={run} mode="activity" />);

    expect(screen.getAllByText("▍").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps tool rows collapsed by default while streaming", () => {
    const toolCall = buildToolCall({
      id: "tool-1",
      step_id: "step-1",
      tool_name: "list_entries",
      display_label: "Listed entries",
      status: "running"
    });
    const run = buildRun({
      id: "run-running-tool",
      status: "running",
      steps: [buildStep({ id: "step-1", step_index: 1 })],
      tool_calls: [toolCall]
    });

    render(<AgentRunBlock run={run} mode="activity" />);

    const toolDetails = screen.getByText("Listed entries").closest("details");
    expect(toolDetails).not.toHaveAttribute("open");
  });

  it("shows only the trailing lines of live model reasoning while streaming", () => {
    const run = buildRun({
      id: "run-streaming-reasoning",
      status: "running",
      steps: []
    });
    const longReasoning = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n");

    const { container } = render(
      <AgentRunBlock run={run} mode="activity" streamingReasoningText={longReasoning} />
    );

    expect(screen.queryByText("line-1")).not.toBeInTheDocument();
    expect(screen.getByText(/line-7/)).toBeInTheDocument();
    expect(container.querySelector(".agent-reasoning-segment-streaming-details")).not.toBeNull();
  });
});
