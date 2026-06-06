import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownRenderer } from "../../../components/ui/MarkdownRenderer";
import { buildRun } from "../../../test/factories/agent";
import { AgentTimeline } from "./AgentTimeline";

function buildMessage(overrides: Partial<import("../../../lib/types").AgentMessage> = {}) {
  return {
    id: overrides.id ?? "message-assistant-1",
    thread_id: overrides.thread_id ?? "thread-1",
    role: overrides.role ?? "assistant",
    content_markdown:
      overrides.content_markdown ??
      "I could not complete this run because the language model request failed.\nError: model request failed: litellm.UnsupportedParamsError: fireworks_ai does not support parameters: ['tools']",
    created_at: overrides.created_at ?? "2026-06-06T17:24:11Z",
    attachments: overrides.attachments ?? []
  };
}

describe("AgentTimeline error rendering", () => {
  it("renders persisted model failures with the real markdown renderer", () => {
    const message = buildMessage();
    const run = buildRun({
      id: "run-failed",
      assistant_message_id: message.id,
      status: "failed",
      error_text:
        "model request failed: litellm.UnsupportedParamsError: fireworks_ai does not support parameters: ['tools']"
    });

    render(
      <AgentTimeline
        selectedThreadId="thread-1"
        isLoading={false}
        errorMessage={null}
        initiatedByExternalAgent={false}
        messages={[message]}
        timelineScrollRef={createRef<HTMLDivElement>()}
        runsByAssistantMessageId={new Map([[message.id, [run]]])}
        pendingAssistantRuns={[]}
        pendingAssistantRunsByUserMessageId={new Map()}
        pendingUserMessage={null}
        pendingAssistantMessage={null}
        shouldShowOptimisticAssistantBubble={false}
        pendingRunAttachedToOptimisticMessage={null}
        activeStreamRunId={null}
        activeStreamReasoningText=""
        activeStreamText=""
        streamedReasoningTextByRunId={{}}
        streamedTextByRunId={{}}
        optimisticRunEventsByRunId={{}}
        optimisticToolCallsByRunId={{}}
        activeOptimisticEvents={[]}
        activeOptimisticToolCalls={[]}
        detachFromBottom={() => undefined}
        onHydrateToolCall={() => undefined}
        hydratingToolCallIds={new Set<string>()}
        isAtBottom
        scrollToBottom={() => undefined}
      />
    );

    expect(screen.getByText(/language model request failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/UnsupportedParamsError/i)).toBeInTheDocument();
  });

  it("renders fenced backend error markdown through the real markdown renderer", () => {
    const markdown =
      "I could not complete this run because the language model request failed.\n\n```\nmodel request failed: boom\n```";
    render(<MarkdownRenderer markdown={markdown} />);
    expect(screen.getByText(/language model request failed/i)).toBeInTheDocument();
    expect(screen.getByText("model request failed: boom")).toBeInTheDocument();
  });
});
