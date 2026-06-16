import { createRef, useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTurn } from "../../../lib/types";
import { buildRun, buildStep, buildToolCall, buildTurn } from "../../../test/factories/agent";
import { AgentTimeline, type AgentTimelineProps } from "./AgentTimeline";
import type { PendingAssistantMessage } from "./types";

const { markdownRenderSpy, requestBlobSpy } = vi.hoisted(() => ({
  markdownRenderSpy: vi.fn(),
  requestBlobSpy: vi.fn()
}));

vi.mock("../../../components/ui/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => {
    markdownRenderSpy(markdown);
    return <div>{markdown}</div>;
  }
}));

vi.mock("../../../lib/api/core", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/core")>("../../../lib/api/core");
  return {
    ...actual,
    requestBlob: requestBlobSpy
  };
});

function buildTurnProjection(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return buildTurn(overrides);
}

function buildPendingAssistantMessage(
  overrides: Partial<PendingAssistantMessage> = {}
): PendingAssistantMessage {
  return {
    id: overrides.id ?? "pending-assistant-1",
    threadId: overrides.threadId ?? "thread-1",
    createdAt: overrides.createdAt ?? "2026-02-15T10:00:00Z",
    baselineLastTurnRunId:
      overrides.baselineLastTurnRunId !== undefined ? overrides.baselineLastTurnRunId : null
  };
}

function renderTimeline(overrides: Partial<AgentTimelineProps> = {}) {
  const props: AgentTimelineProps = {
    selectedThreadId: "thread-1",
    isLoading: false,
    errorMessage: null,
    initiatedByExternalAgent: false,
    turns: [],
    timelineScrollRef: createRef<HTMLDivElement>(),
    runsById: new Map(),
    pendingAssistantRuns: [],
    pendingUserMessage: null,
    pendingAssistantMessage: null,
    shouldShowOptimisticAssistantBubble: false,
    pendingRunAttachedToOptimisticMessage: null,
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
    detachFromBottom: () => undefined,
    onHydrateToolCall: () => undefined,
    hydratingToolCallIds: new Set<string>(),
    isAtBottom: true,
    scrollToBottom: () => undefined,
    ...overrides
  };

  return render(<AgentTimeline {...props} />);
}

function expectArticleClasses(
  element: HTMLElement,
  expectedClasses: string[],
  unexpectedClasses: string[] = []
) {
  const article = element.closest("article");
  expect(article).not.toBeNull();
  for (const className of expectedClasses) {
    expect(article).toHaveClass(className);
  }
  for (const className of unexpectedClasses) {
    expect(article).not.toHaveClass(className);
  }
}

describe("AgentTimeline", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    markdownRenderSpy.mockClear();
    requestBlobSpy.mockReset();
    openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it("does not rerender stable historical markdown for unrelated draft typing", async () => {
    const user = userEvent.setup();
    const turn = buildTurnProjection({
      run_id: "run-1",
      assistant_message: {
        ...buildTurn().assistant_message!,
        content_markdown: "Historical **markdown** reply"
      }
    });
    const run = buildRun({ id: "run-1", status: "completed" });
    const stableProps: AgentTimelineProps = {
      selectedThreadId: "thread-1",
      isLoading: false,
      errorMessage: null,
      initiatedByExternalAgent: false,
      turns: [turn],
      timelineScrollRef: createRef<HTMLDivElement>(),
      runsById: new Map([[run.id, run]]),
      pendingAssistantRuns: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      shouldShowOptimisticAssistantBubble: false,
      pendingRunAttachedToOptimisticMessage: null,
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
      detachFromBottom: () => undefined,
      onHydrateToolCall: () => undefined,
      hydratingToolCallIds: new Set<string>(),
      isAtBottom: true,
      scrollToBottom: () => undefined
    };

    function Harness() {
      const [draft, setDraft] = useState("");
      const timelinePropsRef = useRef(stableProps);

      return (
        <>
          <label>
            Draft
            <input value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <AgentTimeline {...timelinePropsRef.current} />
        </>
      );
    }

    render(<Harness />);

    expect(markdownRenderSpy).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Draft"), "hello world");

    expect(markdownRenderSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Historical **markdown** reply")).toBeInTheDocument();
    expectArticleClasses(screen.getByText("Historical **markdown** reply"), ["agent-message", "agent-message-assistant"], ["agent-message-user"]);
  });

  it("shows an external-agent session hint when the thread was started externally", () => {
    renderTimeline({
      initiatedByExternalAgent: true,
      turns: []
    });

    expect(screen.getByLabelText("External agent session")).toBeInTheDocument();
    expect(screen.getByText(/started by an external agent via/i)).toBeInTheDocument();
  });

  it("keeps user turns as right-aligned bubbles", () => {
    renderTimeline({
      turns: [
        buildTurnProjection({
          run_id: "run-user-1",
          user_message: {
            ...buildTurn().user_message,
            content_markdown: "Bubble me."
          }
        })
      ]
    });

    expectArticleClasses(screen.getByText("Bubble me."), ["agent-message", "agent-message-user"], ["agent-message-assistant"]);
    expect(screen.getByText("Bubble me.").closest(".agent-message-user-bubble")).not.toBeNull();
  });

  it("shows the optimistic assistant caret before the first stream projection arrives", () => {
    const { container } = renderTimeline({
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true
    });

    expect(screen.getByText("▍")).toBeInTheDocument();
    expect(container.querySelector(".agent-message-streaming-text")).not.toBeNull();
    expectArticleClasses(screen.getByText("▍"), ["agent-message", "agent-message-assistant", "agent-message-streaming"], ["agent-message-user"]);
  });

  it("switches into the live activity bubble as soon as optimistic steps arrive", () => {
    const run = buildRun({ id: "run-live", status: "running" });
    const { container } = renderTimeline({
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      pendingRunAttachedToOptimisticMessage: run,
      activeOptimisticSteps: [
        buildStep({ id: "step-1", run_id: run.id, step_index: 1, progress_note: "Starting work." })
      ]
    });

    expect(screen.getAllByText("Starting work.").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".agent-message-streaming-text")).toBeNull();
  });

  it("keeps whitespace-only early stream chunks visible inside the live activity bubble", () => {
    const { container } = renderTimeline({
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      activeStreamText: "  "
    });

    expect(markdownRenderSpy).toHaveBeenCalledWith("  ");
    expect(container.querySelector(".agent-message-streaming-text")).toBeNull();
  });

  it("shows live reasoning text in the activity bubble before the committed step lands", () => {
    renderTimeline({
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      activeStreamReasoningText: "Checking existing entities before proposing changes."
    });

    expect(screen.getAllByText("Checking existing entities before proposing changes.").length).toBeGreaterThanOrEqual(1);
  });

  it("anchors interrupted pending runs after the triggering user turn without duplicating them", () => {
    const turn = buildTurnProjection({
      run_id: "run-interrupted",
      user_message: {
        ...buildTurn().user_message,
        content_markdown: "Please import the statement."
      },
      assistant_message: null
    });
    const interruptedRun = buildRun({
      id: "run-interrupted",
      status: "failed",
      error_detail: "Run interrupted by user."
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[interruptedRun.id, interruptedRun]]),
      pendingAssistantRuns: [interruptedRun]
    });

    expect(markdownRenderSpy).toHaveBeenCalledWith("```\nRun interrupted by user.\n```");
    expect(screen.getByText(/Run interrupted by user\./)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy message" })).toHaveLength(2);
    expect(screen.getByText("Please import the statement.")).toBeInTheDocument();
    expectArticleClasses(screen.getByText(/Run interrupted by user\./), ["agent-message", "agent-message-assistant", "agent-message-activity"], ["agent-message-user"]);
  });

  it("does not render empty assistant shells for tool-only runs without step projections", () => {
    const turn = buildTurnProjection({
      run_id: "run-legacy-tool-only",
      user_message: {
        ...buildTurn().user_message,
        content_markdown: "Show the old run."
      },
      assistant_message: null
    });
    const legacyRun = buildRun({
      id: "run-legacy-tool-only",
      status: "completed",
      steps: [],
      tool_calls: [buildToolCall({ id: "tool-legacy", run_id: "run-legacy-tool-only" })],
      change_items: []
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[legacyRun.id, legacyRun]]),
      pendingAssistantRuns: [legacyRun]
    });

    expect(screen.getByText("Show the old run.")).toBeInTheDocument();
    expect(screen.queryByText("1 tool call")).not.toBeInTheDocument();
  });

  it("renders user attachments as compact file rows above the message text", async () => {
    requestBlobSpy.mockResolvedValue(new Blob(["pdf-bytes"], { type: "application/pdf" }));

    renderTimeline({
      turns: [
        buildTurnProjection({
          run_id: "run-user-attachments",
          user_message: {
            ...buildTurn().user_message,
            content_markdown: "Please review these statements.",
            attachments: [
              {
                id: "attachment-pdf-1",
                display_name: "statement.pdf",
                mime_type: "application/pdf",
                attachment_url: "/api/v1/agent/attachments/attachment-pdf-1"
              }
            ]
          }
        })
      ]
    });

    const bubble = screen.getByText("Please review these statements.").closest(".agent-message-user-bubble");
    expect(bubble).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Open statement.pdf" })).toBeInTheDocument();
    expect(screen.getByText("statement.pdf")).toBeInTheDocument();
    expect(requestBlobSpy).toHaveBeenCalledWith(
      "/api/v1/agent/attachments/attachment-pdf-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("renders attached optimistic tool progress with hydrated tool details and no duplicate run card", async () => {
    const run = buildRun({
      id: "run-live-tools",
      status: "running"
    });
    const toolCall = buildToolCall({
      id: "tool-1",
      run_id: run.id,
      step_id: "step-1",
      tool_name: "list_tags",
      display_label: "list_tags",
      arguments_json: { include_descriptions: true },
      status: "queued",
      output_text: ""
    });

    renderTimeline({
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      pendingAssistantRuns: [run],
      pendingRunAttachedToOptimisticMessage: run,
      activeOptimisticToolCalls: [toolCall]
    });

    expect(screen.getByText("list_tags")).toBeInTheDocument();
    expect(document.querySelectorAll("article.agent-message-assistant")).toHaveLength(1);
    expect(document.querySelectorAll("article.agent-message-user")).toHaveLength(0);

    await userEvent.click(screen.getByText("list_tags"));

    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for tool snapshot...")).not.toBeInTheDocument();
  });

  it("does not show a second streaming caret under live turn activity", () => {
    const run = buildRun({
      id: "run-live-caret",
      status: "running"
    });
    const turn = buildTurnProjection({
      run_id: run.id,
      assistant_message: null
    });
    const toolCall = buildToolCall({
      id: "tool-1",
      run_id: run.id,
      step_id: "step-1",
      tool_name: "rename_thread",
      display_label: "rename_thread",
      status: "running"
    });

    const { container } = renderTimeline({
      turns: [turn],
      runsById: new Map([[run.id, run]]),
      activeStreamRunId: run.id,
      optimisticToolCallsByRunId: { [run.id]: [toolCall] }
    });

    expect(screen.getByText("rename_thread")).toBeInTheDocument();
    expect(container.querySelector(".agent-message-streaming-text")).toBeNull();
  });

  it("does not duplicate live tool activity when the run is already anchored as a turn", () => {
    const run = buildRun({
      id: "run-live-tools",
      status: "running"
    });
    const turn = buildTurnProjection({
      run_id: run.id,
      assistant_message: null
    });
    const toolCall = buildToolCall({
      id: "tool-1",
      run_id: run.id,
      step_id: "step-1",
      tool_name: "list_tags",
      display_label: "list_tags",
      status: "running"
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[run.id, run]]),
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      pendingRunAttachedToOptimisticMessage: run,
      optimisticToolCallsByRunId: { [run.id]: [toolCall] },
      activeOptimisticToolCalls: [toolCall]
    });

    expect(screen.getAllByText("list_tags")).toHaveLength(1);
    expect(document.querySelectorAll("article.agent-message-assistant")).toHaveLength(1);
  });

  it("keeps anchored live ledger tool rows visible when run projections are empty", () => {
    const run = buildRun({
      id: "run-ledger",
      status: "running",
      tool_calls: [],
      steps: []
    });
    const turn = buildTurnProjection({
      run_id: run.id,
      assistant_message: null
    });
    const toolOne = buildToolCall({
      id: "tool-1",
      run_id: run.id,
      tool_name: "list_entries",
      display_label: "list_entries",
      status: "ok"
    });
    const toolTwo = buildToolCall({
      id: "tool-2",
      run_id: run.id,
      tool_name: "list_tags",
      display_label: "list_tags",
      status: "running"
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[run.id, run]]),
      activeStreamRunId: run.id,
      liveActivityLedgerByRunId: {
        [run.id]: [
          {
            type: "tool_call",
            key: "tool-1",
            runId: run.id,
            toolCallId: "tool-1",
            toolCall: toolOne,
            createdAt: "2026-02-15T10:00:01.000Z"
          },
          {
            type: "tool_call",
            key: "tool-2",
            runId: run.id,
            toolCallId: "tool-2",
            toolCall: toolTwo,
            createdAt: "2026-02-15T10:00:02.000Z"
          }
        ]
      }
    });

    expect(screen.getByText("list_entries")).toBeInTheDocument();
    expect(screen.getByText("list_tags")).toBeInTheDocument();
    const liveBubbleText = document.querySelector("article.agent-message-streaming")?.textContent ?? "";
    expect(liveBubbleText.indexOf("list_tags")).toBeGreaterThan(liveBubbleText.indexOf("list_entries"));
  });

  it("keeps live tool rows visible while the next reasoning segment streams", () => {
    const run = buildRun({
      id: "run-reasoning-after-tools",
      status: "running",
      tool_calls: [],
      steps: []
    });
    const turn = buildTurnProjection({
      run_id: run.id,
      assistant_message: null
    });
    const toolOne = buildToolCall({
      id: "tool-1",
      run_id: run.id,
      tool_name: "list_entries",
      display_label: "list_entries",
      status: "ok"
    });
    const toolTwo = buildToolCall({
      id: "tool-2",
      run_id: run.id,
      tool_name: "list_tags",
      display_label: "list_tags",
      status: "ok"
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[run.id, run]]),
      activeStreamRunId: run.id,
      activeStreamReasoningText: "Thinking through the follow-up after tools.",
      liveActivityLedgerByRunId: {
        [run.id]: [
          {
            type: "tool_call",
            key: "tool-1",
            runId: run.id,
            toolCallId: "tool-1",
            toolCall: toolOne,
            createdAt: "2026-02-15T10:00:01.000Z"
          },
          {
            type: "tool_call",
            key: "tool-2",
            runId: run.id,
            toolCallId: "tool-2",
            toolCall: toolTwo,
            createdAt: "2026-02-15T10:00:02.000Z"
          }
        ]
      }
    });

    expect(screen.getByText("list_entries")).toBeInTheDocument();
    expect(screen.getByText("list_tags")).toBeInTheDocument();
    expect(screen.getByText("Thinking through the follow-up after tools.")).toBeInTheDocument();
  });

  it("collapses committed reasoning content while the run is still live", async () => {
    const run = buildRun({
      id: "run-live-committed-reasoning",
      status: "running",
      steps: [
        buildStep({
          id: "assistant-message-1",
          run_id: "run-live-committed-reasoning",
          reasoning_text: "I need to inspect recent entries before choosing the tool."
        })
      ]
    });
    const turn = buildTurnProjection({
      run_id: run.id,
      assistant_message: null
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[run.id, run]]),
      activeStreamRunId: run.id
    });

    const summary = screen.getByText(/Thought .* tokens/);
    expect(summary).toBeInTheDocument();
    expect(screen.queryByText("I need to inspect recent entries before choosing the tool.")).not.toBeInTheDocument();

    await userEvent.click(summary);

    expect(screen.getByText("I need to inspect recent entries before choosing the tool.")).toBeInTheDocument();
  });

  it("keeps pre-anchored live ledger tool rows visible without transient optimistic arrays", () => {
    const runId = "run-preanchor-ledger";
    const toolOne = buildToolCall({
      id: "tool-1",
      run_id: runId,
      tool_name: "list_entries",
      display_label: "list_entries",
      status: "ok"
    });
    const toolTwo = buildToolCall({
      id: "tool-2",
      run_id: runId,
      tool_name: "list_tags",
      display_label: "list_tags",
      status: "running"
    });

    renderTimeline({
      activeStreamRunId: runId,
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      liveActivityLedgerByRunId: {
        [runId]: [
          {
            type: "tool_call",
            key: "tool-1",
            runId,
            toolCallId: "tool-1",
            toolCall: toolOne,
            createdAt: "2026-02-15T10:00:01.000Z"
          },
          {
            type: "tool_call",
            key: "tool-2",
            runId,
            toolCallId: "tool-2",
            toolCall: toolTwo,
            createdAt: "2026-02-15T10:00:02.000Z"
          }
        ]
      }
    });

    expect(screen.getByText("list_entries")).toBeInTheDocument();
    expect(screen.getByText("list_tags")).toBeInTheDocument();
    expect(document.querySelector(".agent-message-streaming-text")).toBeNull();
  });

  it("shows persisted progress notes and in-flight streamed text together in one live bubble", () => {
    const run = buildRun({
      id: "run-live-update",
      status: "running"
    });

    renderTimeline({
      pendingAssistantMessage: buildPendingAssistantMessage(),
      shouldShowOptimisticAssistantBubble: true,
      pendingRunAttachedToOptimisticMessage: run,
      activeOptimisticSteps: [
        buildStep({
          id: "step-1",
          run_id: run.id,
          step_index: 1,
          progress_note: "Drafting the first batch now."
        })
      ],
      activeStreamText: "Still streaming the next sentence..."
    });

    expect(screen.getAllByText("Drafting the first batch now.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Still streaming the next sentence...").length).toBeGreaterThanOrEqual(1);

    const liveBubbleText = document.querySelector("article.agent-message-streaming")?.textContent ?? "";
    expect(liveBubbleText.indexOf("Drafting the first batch now.")).toBeGreaterThanOrEqual(0);
    expect(liveBubbleText.indexOf("Still streaming the next sentence...")).toBeGreaterThan(
      liveBubbleText.indexOf("Drafting the first batch now.")
    );
  });

  it("streams reasoning on a persisted assistant turn when the run is still running", () => {
    const turn = buildTurnProjection({
      run_id: "run-persisted",
      assistant_message: null
    });
    const run = buildRun({
      id: "run-persisted",
      status: "running"
    });

    renderTimeline({
      turns: [turn],
      runsById: new Map([[run.id, run]]),
      activeStreamRunId: null,
      streamedReasoningTextByRunId: { "run-persisted": "Checking entities before proposing changes." }
    });

    expect(screen.getByText("Checking entities before proposing changes.")).toBeInTheDocument();
  });

  it("streams reasoning on pending run cards while buffers are live", () => {
    const run = buildRun({
      id: "run-pending",
      status: "running"
    });

    renderTimeline({
      pendingAssistantRuns: [run],
      streamedReasoningTextByRunId: { "run-pending": "Still thinking through the next step." }
    });

    expect(screen.getByText("Still thinking through the next step.")).toBeInTheDocument();
  });

  it("renders reconnect stream buffers on pending run cards", () => {
    const run = buildRun({
      id: "run-reconnect",
      status: "running"
    });

    renderTimeline({
      pendingAssistantRuns: [run],
      streamedReasoningTextByRunId: { "run-reconnect": "Resuming after refresh." }
    });

    expect(screen.getByText("Resuming after refresh.")).toBeInTheDocument();
  });
});
