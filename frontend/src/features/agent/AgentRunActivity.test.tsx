/**
 * CALLING SPEC:
 * - Purpose: verify pending agent activity reconciles hydrated tool snapshots into live stream rows.
 * - Inputs: compact live ledger items and updated optimistic tool-call snapshots.
 * - Outputs: assertions over the rendered pending activity block.
 * - Side effects: jsdom rendering and user interaction only.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { buildToolCall } from "../../test/factories/agent";
import { PendingAssistantActivityBlock } from "./AgentRunActivity";
import type { RunActivityItem } from "./activity";

describe("PendingAssistantActivityBlock", () => {
  it("reconciles hydrated tool details into an open live stream row", async () => {
    const compactToolCall = buildToolCall({
      id: "tool-import",
      run_id: "run-import",
      tool_name: "run_bh",
      display_label: "bh entries import",
      has_full_payload: false,
      arguments_json: null,
      result_content_json: null,
      output_text: null,
      status: "running"
    });
    const liveActivityItems: RunActivityItem[] = [
      {
        type: "tool_call",
        key: compactToolCall.id,
        runId: compactToolCall.run_id,
        toolCallId: compactToolCall.id,
        toolCall: compactToolCall,
        createdAt: "2026-07-31T21:15:27.000Z"
      }
    ];
    const onHydrateToolCall = vi.fn();
    const view = render(
      <PendingAssistantActivityBlock
        steps={[]}
        toolCalls={[compactToolCall]}
        liveActivityItems={liveActivityItems}
        onHydrateToolCall={onHydrateToolCall}
        hydratingToolCallIds={new Set([compactToolCall.id])}
      />
    );

    await userEvent.click(screen.getByText("bh entries import"));
    expect(screen.getByText("Loading tool call details...")).toBeInTheDocument();
    expect(onHydrateToolCall).toHaveBeenCalledWith("run-import", "tool-import");

    const hydratedToolCall = buildToolCall({
      ...compactToolCall,
      has_full_payload: true,
      arguments_json: { argv: ["entries", "import"] }
    });
    view.rerender(
      <PendingAssistantActivityBlock
        steps={[]}
        toolCalls={[hydratedToolCall]}
        liveActivityItems={liveActivityItems}
        onHydrateToolCall={onHydrateToolCall}
        hydratingToolCallIds={new Set()}
      />
    );

    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText(/"entries"/)).toBeInTheDocument();
    expect(screen.queryByText("Loading tool call details...")).not.toBeInTheDocument();
  });
});
