import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../lib/api";
import { renderWithQueryClient } from "../../test/renderWithQueryClient";
import { listOrEmpty } from "../../lib/collections";
import { buildChangeItem, buildRun, buildToolCall } from "../../test/factories/agent";
import { AgentPanel } from "./AgentPanel";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    approveAgentChangeItem: vi.fn(),
    createAgentThread: vi.fn(),
    deleteAgentThread: vi.fn(),
    getAgentThread: vi.fn(),
    getAgentToolCall: vi.fn(),
    getRuntimeSettings: vi.fn(),
    interruptAgentRun: vi.fn(),
    listAgentThreads: vi.fn(),
    listCurrencies: vi.fn(),
    listEntities: vi.fn(),
    listTags: vi.fn(),
    reopenAgentChangeItem: vi.fn(),
    renameAgentThread: vi.fn(),
    rejectAgentChangeItem: vi.fn(),
    deleteAgentDraftAttachment: vi.fn(),
    sendAgentMessage: vi.fn(),
    streamAgentMessage: vi.fn(),
    uploadAgentDraftAttachment: vi.fn()
  };
});

function buildThreadSummary(overrides: Partial<Awaited<ReturnType<typeof api.listAgentThreads>>[number]> = {}) {
  return {
    id: overrides.id ?? "thread-1",
    title: overrides.title ?? "Review thread",
    created_at: overrides.created_at ?? "2026-03-06T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-03-06T10:05:00Z",
    last_message_preview: overrides.last_message_preview ?? "Latest update",
    pending_change_count: overrides.pending_change_count ?? 1,
    has_running_run: overrides.has_running_run ?? false,
    initiated_by_external_agent: overrides.initiated_by_external_agent ?? false
  };
}

function buildThreadDetail(
  runs: ReturnType<typeof buildRun>[],
  overrides: Partial<{
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
  }> = {}
) {
  return {
    thread: {
      id: overrides.id ?? "thread-1",
      title: overrides.title ?? "Review thread",
      created_at: overrides.created_at ?? "2026-03-06T10:00:00Z",
      updated_at: overrides.updated_at ?? "2026-03-06T10:05:00Z",
      initiated_by_external_agent: false
    },
    turns: [],
    runs,
    configured_model_name: "gpt-test",
    current_context_tokens: 42
  };
}

type RuntimeSettingsResponse = Awaited<ReturnType<typeof api.getRuntimeSettings>>;
type RuntimeSettingsOverrideInput = Partial<Omit<RuntimeSettingsResponse, "overrides">> & {
  overrides?: Partial<RuntimeSettingsResponse["overrides"]>;
};

function buildRuntimeSettings(overrides: RuntimeSettingsOverrideInput = {}) {
  const baseOverrides: RuntimeSettingsResponse["overrides"] = {
    user_memory: null,
    default_currency_code: null,
    dashboard_currency_code: null,
    agent_model: null,
    entry_tagging_model: null,
    available_agent_models: null,
    agent_model_display_names: null,
    agent_model_reasoning_efforts: null,
    agent_max_steps: null,
    agent_bulk_max_concurrent_threads: null,
    agent_retry_max_attempts: null,
    agent_retry_initial_wait_seconds: null,
    agent_retry_max_wait_seconds: null,
    agent_retry_backoff_multiplier: null,
    agent_max_image_size_bytes: null,
    agent_max_images_per_message: null,
    agent_max_pdf_pages: null,
    agent_base_url: null,
    agent_api_key_configured: true
  };

  return {
    user_memory: null,
    default_currency_code: "USD",
    dashboard_currency_code: "USD",
    agent_model: "gpt-test",
    entry_tagging_model: null,
    available_agent_models: ["gpt-test", "openai/gpt-4.1-mini", "openrouter/qwen/qwen3.5-27b"],
    agent_model_display_names: {},
    agent_model_reasoning_efforts: {},
    vision_capable_agent_models: ["openrouter/qwen/qwen3.5-27b"],
    agent_max_steps: 8,
    agent_bulk_max_concurrent_threads: 4,
    agent_retry_max_attempts: 3,
    agent_retry_initial_wait_seconds: 1,
    agent_retry_max_wait_seconds: 10,
    agent_retry_backoff_multiplier: 2,
    agent_max_image_size_bytes: 1000000,
    agent_max_images_per_message: 5,
    agent_max_pdf_pages: 10,
    agent_base_url: null,
    agent_api_key_configured: true,
    ...overrides,
    overrides: {
      ...baseOverrides,
      ...overrides.overrides
    }
  };
}

function buildPdfFile(name: string) {
  return new File(["%PDF-1.7"], name, { type: "application/pdf" });
}

function uploadedAttachmentIdForFileName(name: string) {
  return `draft-${name}`;
}

async function selectAgentModel(modelName: string) {
  await userEvent.click(screen.getByRole("button", { name: "Agent model" }));
  await userEvent.click(screen.getByRole("option", { name: modelName }));
}

describe("AgentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createAgentThread).mockResolvedValue({
      id: "thread-created",
      title: null,
      created_at: "2026-03-06T10:00:00Z",
      updated_at: "2026-03-06T10:00:00Z",
      initiated_by_external_agent: false
    });
    vi.mocked(api.listCurrencies).mockResolvedValue([
      { code: "USD", name: "US Dollar", entry_count: 1, is_placeholder: false }
    ]);
    vi.mocked(api.listEntities).mockResolvedValue([
      { id: "entity-1", name: "Main Checking", category: "account", is_account: true, net_amount_mixed_currencies: false }
    ]);
    vi.mocked(api.listTags).mockResolvedValue([
      { id: 1, name: "food", color: "#7fb069", type: "daily", entry_count: 0 }
    ]);
    vi.mocked(api.getRuntimeSettings).mockResolvedValue(buildRuntimeSettings());
    vi.mocked(api.getAgentToolCall).mockResolvedValue(
      listOrEmpty(buildRun({}).tool_calls)[0] ?? {
        id: "tool-call-1",
        run_id: "run-1",
        step_id: "step-1",
        call_index: 0,
        tool_request_id: "tool-request-1",
        tool_name: "list_entries",
        display_label: "Listed entries",
        display_detail: null,
        arguments_json: {},
        result_content_json: {},
        output_text: "",
        has_full_payload: true,
        status: "ok",
        error_code: null,
        started_at: "2026-03-06T10:00:00Z",
        completed_at: "2026-03-06T10:00:00Z"
      }
    );
    vi.mocked(api.approveAgentChangeItem).mockResolvedValue(
      buildChangeItem({ status: "APPLIED", applied_resource_type: "tag", applied_resource_id: "1" })
    );
    vi.mocked(api.rejectAgentChangeItem).mockResolvedValue(buildChangeItem({ status: "REJECTED" }));
    vi.mocked(api.reopenAgentChangeItem).mockResolvedValue(buildChangeItem({ status: "PENDING_REVIEW" }));
    vi.mocked(api.deleteAgentThread).mockResolvedValue();
    vi.mocked(api.deleteAgentDraftAttachment).mockResolvedValue();
    vi.mocked(api.interruptAgentRun).mockResolvedValue(buildRun({ status: "failed", error_detail: "Run interrupted by user." }));
    vi.mocked(api.renameAgentThread).mockResolvedValue({
      id: "thread-1",
      title: "Review thread",
      created_at: "2026-03-06T10:00:00Z",
      updated_at: "2026-03-06T10:05:00Z",
      initiated_by_external_agent: false
    });
    vi.mocked(api.uploadAgentDraftAttachment).mockImplementation(async ({ file }) => ({
      id: uploadedAttachmentIdForFileName(file.name),
      display_name: file.name,
      mime_type: file.type || "application/octet-stream",
      created_at: "2026-03-06T10:00:00Z"
    }));
    vi.mocked(api.sendAgentMessage).mockResolvedValue(
      buildRun({
        status: "running",
        completed_at: null
      })
    );
    vi.mocked(api.streamAgentMessage).mockResolvedValue();
  });

  it("exposes a debug transcript copy action for the selected thread", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([buildRun({ id: "run-debug-1", thread_id: "thread-1" })])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Copy debug" })).toBeEnabled());
  });

  it("opens the thread review modal from the header button", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([
        buildRun({
          id: "run-1",
          change_items: [
            buildChangeItem({
              id: "change-1",
              run_id: "run-1",
              change_type: "create_tag",
              payload_json: {
                name: "subscriptions",
                type: "recurring"
              }
            })
          ]
        })
      ])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    const reviewButton = await screen.findByRole("button", { name: /Review/i });
    await waitFor(() => expect(reviewButton).toBeEnabled());

    await userEvent.click(reviewButton);

    expect(await screen.findByText("Thread review")).toBeInTheDocument();
  });

  it("keeps the header review button disabled when the thread has no proposals", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary({ pending_change_count: 0 })]);
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([
        buildRun({
          id: "run-1",
          change_items: []
        })
      ])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    const reviewButton = await screen.findByRole("button", { name: "Review" });

    await waitFor(() => expect(reviewButton).toBeDisabled());
  });

  it("uses the pending review styling and shows a readable count badge", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary({ pending_change_count: 2 })]);
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([
        buildRun({
          id: "run-1",
          change_items: [
            buildChangeItem({ id: "change-1", run_id: "run-1", status: "PENDING_REVIEW" }),
            buildChangeItem({ id: "change-2", run_id: "run-1", status: "PENDING_REVIEW" })
          ]
        })
      ])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    const reviewButton = await screen.findByRole("button", { name: /Review/i });
    await waitFor(() => expect(reviewButton).toBeEnabled());
    expect(reviewButton).toHaveClass("agent-panel-review-button", "is-pending");

    const countBadge = screen.getByText("2");
    expect(countBadge).toHaveClass("agent-panel-review-badge");
  });

  it("confirms thread deletion in the app dialog instead of using the browser confirm", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread).mockResolvedValue(buildThreadDetail([]));

    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);

    try {
      renderWithQueryClient(<AgentPanel isOpen />);

      await screen.findByRole("button", { name: "Review thread" });
      await userEvent.click(screen.getByRole("button", { name: "Delete thread Review thread" }));

      const deleteDialog = await screen.findByRole("dialog", { name: "Delete Review thread?" });
      expect(within(deleteDialog).getByText("This removes the full message and run history for this thread.")).toBeInTheDocument();

      await userEvent.click(within(deleteDialog).getByRole("button", { name: "Delete thread" }));

      await waitFor(() => {
        expect(api.deleteAgentThread).toHaveBeenCalled();
      });
      expect(vi.mocked(api.deleteAgentThread).mock.calls[0]?.[0]).toBe("thread-1");
      expect(confirmSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("shows attachment upload then vision preparation progress before the draft becomes ready", async () => {
    let resolveUpload: (() => void) | null = null;

    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread).mockResolvedValue(buildThreadDetail([]));
    vi.mocked(api.uploadAgentDraftAttachment).mockImplementation(
      ({ file, onUploadProgress, onServerProcessingStart }) =>
        new Promise((resolve) => {
          onUploadProgress?.(42);
          onServerProcessingStart?.();
          resolveUpload = () =>
            resolve({
              id: uploadedAttachmentIdForFileName(file.name),
              display_name: file.name,
              mime_type: file.type || "application/octet-stream",
              created_at: "2026-03-06T10:00:00Z"
            });
        })
    );

    const { container } = renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Review thread" });
    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected file input");
    }

    await userEvent.upload(fileInput, [buildPdfFile("statement.pdf")]);

    expect(await screen.findByText("statement.pdf")).toBeInTheDocument();
    expect(screen.getByText("Preparing pages…")).toBeInTheDocument();
    expect(api.uploadAgentDraftAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        useOcr: false
      })
    );

    await act(async () => {
      resolveUpload?.();
    });

    await waitFor(() => expect(screen.queryByText("Preparing pages…")).not.toBeInTheDocument());
    expect(screen.getByText("statement.pdf")).toBeInTheDocument();
  });

  it("waits for attachment preparation before sending the streamed message", async () => {
    let resolveUpload: (() => void) | null = null;

    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread)
      .mockResolvedValueOnce(buildThreadDetail([]))
      .mockResolvedValue(buildThreadDetail([]));
    vi.mocked(api.uploadAgentDraftAttachment).mockImplementation(
      ({ file }) =>
        new Promise((resolve) => {
          resolveUpload = () =>
            resolve({
              id: uploadedAttachmentIdForFileName(file.name),
              display_name: file.name,
              mime_type: file.type || "application/octet-stream",
              created_at: "2026-03-06T10:00:00Z"
            });
        })
    );

    const { container } = renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Review thread" });
    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected file input");
    }

    await userEvent.upload(fileInput, [buildPdfFile("statement.pdf")]);
    await userEvent.type(screen.getByRole("textbox"), "Review this statement");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(api.streamAgentMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpload?.();
    });

    await waitFor(() =>
      expect(api.streamAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-1",
          content: "Review this statement",
          files: [],
          attachmentIds: [uploadedAttachmentIdForFileName("statement.pdf")],
          attachmentsUseOcr: false
        })
      )
    );
  });

  it("uses vision preparation without exposing OCR controls", async () => {
    let resolveUpload: (() => void) | null = null;

    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread)
      .mockResolvedValueOnce(buildThreadDetail([]))
      .mockResolvedValue(buildThreadDetail([]));
    vi.mocked(api.uploadAgentDraftAttachment).mockImplementation(
      ({ file, onUploadProgress, onServerProcessingStart }) =>
        new Promise((resolve) => {
          onUploadProgress?.(100);
          onServerProcessingStart?.();
          resolveUpload = () =>
            resolve({
              id: uploadedAttachmentIdForFileName(file.name),
              display_name: file.name,
              mime_type: file.type || "application/octet-stream",
              created_at: "2026-03-06T10:00:00Z"
            });
        })
    );

    const { container } = renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Review thread" });
    await selectAgentModel("openrouter/qwen/qwen3.5-27b");
    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected file input");
    }

    await userEvent.upload(fileInput, [buildPdfFile("statement.pdf")]);
    await screen.findByText("statement.pdf");

    expect(screen.queryByRole("switch", { name: "Use OCR for attachments" })).not.toBeInTheDocument();
    expect(await screen.findByText("Preparing pages…")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "Use vision");
    const sendPromise = userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.streamAgentMessage).not.toHaveBeenCalled());

    await act(async () => {
      resolveUpload?.();
    });
    await sendPromise;

    await waitFor(() =>
      expect(api.streamAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-1",
          attachmentsUseOcr: false
        })
      )
    );
  });

  it("switches back to Send on an idle thread while another thread is still streaming", async () => {
    let activeStreams = 0;
    let maxActiveStreams = 0;
    const streamResolvers: Record<string, () => void> = {};

    vi.mocked(api.listAgentThreads).mockResolvedValue([
      buildThreadSummary({ id: "thread-1", title: "Thread 1" }),
      buildThreadSummary({ id: "thread-2", title: "Thread 2", updated_at: "2026-03-06T10:04:00Z" })
    ]);
    vi.mocked(api.getAgentThread).mockImplementation(async (threadId) =>
      buildThreadDetail([], { id: threadId, title: threadId === "thread-1" ? "Thread 1" : "Thread 2" })
    );
    vi.mocked(api.streamAgentMessage).mockImplementation(async ({ threadId, onEvent }) => {
      activeStreams += 1;
      maxActiveStreams = Math.max(maxActiveStreams, activeStreams);
      onEvent({
        type: "model_delta",
        run_id: `run-${threadId}`,
        step_index: 1,
        delta_type: "reasoning",
        text: "Thinking"
      });
      await new Promise<void>((resolve) => {
        streamResolvers[threadId] = () => {
          activeStreams -= 1;
          resolve();
        };
      });
    });

    renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Thread 1" });
    await userEvent.type(screen.getByRole("textbox"), "First thread message");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Thread 2" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "Second thread message");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledTimes(2));
    expect(maxActiveStreams).toBe(2);
    expect(vi.mocked(api.streamAgentMessage).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ threadId: "thread-1", content: "First thread message" })
    );
    expect(vi.mocked(api.streamAgentMessage).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ threadId: "thread-2", content: "Second thread message" })
    );

    await act(async () => {
      streamResolvers["thread-2"]?.();
      streamResolvers["thread-1"]?.();
    });
  });

  it("stops only the selected thread after switching during parallel streams", async () => {
    const streamResolvers: Record<string, () => void> = {};

    vi.mocked(api.listAgentThreads).mockResolvedValue([
      buildThreadSummary({ id: "thread-1", title: "Thread 1" }),
      buildThreadSummary({ id: "thread-2", title: "Thread 2", updated_at: "2026-03-06T10:04:00Z" })
    ]);
    vi.mocked(api.getAgentThread).mockImplementation(async (threadId) =>
      buildThreadDetail([], { id: threadId, title: threadId === "thread-1" ? "Thread 1" : "Thread 2" })
    );
    vi.mocked(api.streamAgentMessage).mockImplementation(({ threadId, signal, onEvent }) => {
      onEvent({
        type: "model_delta",
        run_id: `run-${threadId}`,
        step_index: 1,
        delta_type: "reasoning",
        text: "Thinking"
      });
      return new Promise<void>((resolve, reject) => {
        const abortHandler = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        signal?.addEventListener("abort", abortHandler, { once: true });
        streamResolvers[threadId] = () => {
          signal?.removeEventListener("abort", abortHandler);
          resolve();
        };
      });
    });

    renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Thread 1" });
    await userEvent.type(screen.getByRole("textbox"), "First thread message");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Thread 2" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());

    await userEvent.type(screen.getByRole("textbox"), "Second thread message");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(api.interruptAgentRun).toHaveBeenCalledWith("run-thread-2"));
    expect(api.interruptAgentRun).not.toHaveBeenCalledWith("run-thread-1");

    await act(async () => {
      streamResolvers["thread-1"]?.();
    });
  });

  it("updates the thread title immediately when rename_thread streams", async () => {
    let resolveStream: (() => void) | null = null;

    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getAgentThread)
      .mockResolvedValueOnce(buildThreadDetail([]))
      .mockResolvedValue(buildThreadDetail([]));
    vi.mocked(api.getAgentToolCall).mockResolvedValue(
      buildToolCall({
        id: "tool-call-rename",
        run_id: "run-1",
        tool_name: "rename_thread",
        arguments_json: { title: "Budget Review" },
        result_content_json: { status: "ok", title: "Budget Review" },
        output_text: "OK\nsummary: renamed thread to Budget Review",
        has_full_payload: true,
        status: "ok"
      })
    );
    vi.mocked(api.streamAgentMessage).mockImplementation(async ({ onEvent }) => {
      await act(async () => {
        onEvent({
          type: "tool_started",
          run_id: "run-1",
          step_index: 1,
          tool_call_id: "tool-call-rename",
          tool_name: "rename_thread"
        });
      });
      await new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });

    renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Review thread" });
    const composer = await screen.findByPlaceholderText(
      "Ask a question or ask the agent to propose entries/tags/entities..."
    );
    await userEvent.type(composer, "Rename the thread");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.getAgentToolCall).toHaveBeenCalledWith("tool-call-rename"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Budget Review" })).toBeInTheDocument());

    await act(async () => {
      resolveStream?.();
    });
  });

  it("initializes the composer model picker from the latest thread run model", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getRuntimeSettings).mockResolvedValue(
      buildRuntimeSettings({
        agent_model: "bedrock/us.anthropic.claude-sonnet-4-6",
        available_agent_models: ["bedrock/us.anthropic.claude-sonnet-4-6", "openai/gpt-4.1-mini"],
        overrides: { agent_model: "bedrock/us.anthropic.claude-sonnet-4-6" }
      })
    );
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([
        buildRun({ model_name: "openai/gpt-4.1-mini" })
      ])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    const modelPicker = await screen.findByRole("button", { name: "Agent model" });
    await waitFor(() => expect(modelPicker).toHaveTextContent("openai/gpt-4.1-mini"));
    await userEvent.click(modelPicker);
    expect(within(screen.getByRole("listbox", { name: "Select option" })).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "bedrock/us.anthropic.claude-sonnet-4-6",
      "openai/gpt-4.1-mini"
    ]);
  });

  it("keeps the composer model picker empty when no models are available", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getRuntimeSettings).mockResolvedValue(
      buildRuntimeSettings({
        agent_model: "bedrock/us.anthropic.claude-sonnet-4-6",
        available_agent_models: []
      })
    );
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([
        buildRun({ model_name: "openai/gpt-4.1-mini" })
      ])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    const modelPicker = await screen.findByRole("button", { name: "Agent model" });

    await waitFor(() => expect(modelPicker).toHaveTextContent("Loading models…"));
    expect(modelPicker).toBeDisabled();
  });

  it("keeps the Bill Assistant title stable when the composer model picker changes", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getRuntimeSettings).mockResolvedValue(
      buildRuntimeSettings({
        agent_model: "gpt-test",
        available_agent_models: ["gpt-test", "openai/gpt-4.1-mini"]
      })
    );
    vi.mocked(api.getAgentThread).mockResolvedValue(
      buildThreadDetail([
        buildRun({ model_name: "openai/gpt-4.1-mini" })
      ])
    );

    renderWithQueryClient(<AgentPanel isOpen />);

    const modelPicker = await screen.findByRole("button", { name: "Agent model" });
    await waitFor(() => expect(modelPicker).toHaveTextContent("openai/gpt-4.1-mini"));
    expect(await screen.findByRole("heading", { name: "Bill Assistant" })).toBeInTheDocument();

    await selectAgentModel("gpt-test");

    expect(screen.getByRole("heading", { name: "Bill Assistant" })).toBeInTheDocument();
    expect(modelPicker).toHaveTextContent("gpt-test");
  });

  it("uses the selected composer model for the next streamed send", async () => {
    vi.mocked(api.listAgentThreads).mockResolvedValue([buildThreadSummary()]);
    vi.mocked(api.getRuntimeSettings).mockResolvedValue(
      buildRuntimeSettings({
        agent_model: "bedrock/us.anthropic.claude-sonnet-4-6",
        available_agent_models: ["bedrock/us.anthropic.claude-sonnet-4-6", "openai/gpt-4.1-mini"]
      })
    );
    vi.mocked(api.getAgentThread)
      .mockResolvedValueOnce(buildThreadDetail([]))
      .mockResolvedValue(buildThreadDetail([]));

    renderWithQueryClient(<AgentPanel isOpen />);

    await screen.findByRole("button", { name: "Review thread" });
    await selectAgentModel("openai/gpt-4.1-mini");
    await userEvent.type(screen.getByRole("textbox"), "Use the faster model next");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(api.streamAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-1",
          content: "Use the faster model next",
          modelName: "openai/gpt-4.1-mini"
        })
      )
    );
  });
});
