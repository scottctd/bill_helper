import type { AgentChangeItem, AgentRun, AgentRunStep, AgentToolCall, AgentTurn } from "../../lib/types";

export function buildStep(overrides: Partial<AgentRunStep> = {}): AgentRunStep {
  return {
    id: overrides.id ?? "step-1",
    run_id: overrides.run_id ?? "run-1",
    step_index: overrides.step_index ?? 1,
    status: overrides.status ?? "committed",
    reasoning_text: overrides.reasoning_text !== undefined ? overrides.reasoning_text : null,
    progress_note: overrides.progress_note !== undefined ? overrides.progress_note : null,
    reasoning_duration_ms:
      overrides.reasoning_duration_ms !== undefined ? overrides.reasoning_duration_ms : null,
    latency_ms: overrides.latency_ms !== undefined ? overrides.latency_ms : null,
    created_at: overrides.created_at ?? "2026-02-15T10:00:00Z"
  };
}

export function buildToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: overrides.id ?? "tool-call-1",
    run_id: overrides.run_id ?? "run-1",
    step_id: overrides.step_id ?? "step-1",
    call_index: overrides.call_index ?? 0,
    tool_request_id: overrides.tool_request_id ?? "tool-request-1",
    tool_name: overrides.tool_name ?? "list_entries",
    display_label: overrides.display_label ?? (overrides.tool_name ?? "list_entries"),
    display_detail: overrides.display_detail !== undefined ? overrides.display_detail : null,
    arguments_json: overrides.arguments_json !== undefined ? overrides.arguments_json : {},
    result_content_json: overrides.result_content_json !== undefined ? overrides.result_content_json : {},
    output_text: overrides.output_text !== undefined ? overrides.output_text : "OK\nsummary: test",
    has_full_payload: overrides.has_full_payload !== undefined ? overrides.has_full_payload : true,
    status: overrides.status ?? "ok",
    error_code: overrides.error_code !== undefined ? overrides.error_code : null,
    started_at: overrides.started_at !== undefined ? overrides.started_at : "2026-02-15T10:00:00Z",
    completed_at: overrides.completed_at !== undefined ? overrides.completed_at : "2026-02-15T10:00:01Z"
  };
}

export function buildChangeItem(overrides: Partial<AgentChangeItem> = {}): AgentChangeItem {
  return {
    id: overrides.id ?? "change-item-1",
    run_id: overrides.run_id ?? "run-1",
    change_type: overrides.change_type ?? "create_entry",
    payload_json: overrides.payload_json ?? { name: "test" },
    status: overrides.status ?? "PENDING_REVIEW",
    review_note: overrides.review_note ?? null,
    applied_resource_type: overrides.applied_resource_type ?? null,
    applied_resource_id: overrides.applied_resource_id ?? null,
    created_at: overrides.created_at ?? "2026-02-15T10:00:00Z",
    updated_at: overrides.updated_at ?? "2026-02-15T10:00:00Z",
    review_actions: overrides.review_actions ?? []
  };
}

export function buildTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    run_id: overrides.run_id ?? "run-1",
    turn_index: overrides.turn_index ?? 0,
    status: overrides.status ?? "completed",
    user_message: overrides.user_message ?? {
      id: "user-message-1",
      role: "user",
      content_markdown: "Hello",
      reasoning_text: null,
      created_at: "2026-02-15T10:00:00Z",
      attachments: []
    },
    assistant_message: overrides.assistant_message === undefined ? {
      id: "assistant-message-1",
      role: "assistant",
      content_markdown: "Done.",
      reasoning_text: null,
      created_at: "2026-02-15T10:00:01Z",
      attachments: []
    } : overrides.assistant_message
  };
}

export function buildRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: overrides.id ?? "run-1",
    thread_id: overrides.thread_id ?? "thread-1",
    turn_index: overrides.turn_index ?? 0,
    status: overrides.status ?? "completed",
    model_name: overrides.model_name ?? "gpt-test",
    origin: overrides.origin ?? "app",
    approval_policy: overrides.approval_policy ?? "default",
    final_assistant_reply:
      overrides.final_assistant_reply !== undefined ? overrides.final_assistant_reply : "Done.",
    context_tokens: overrides.context_tokens !== undefined ? overrides.context_tokens : 10,
    input_tokens: overrides.input_tokens !== undefined ? overrides.input_tokens : 10,
    output_tokens: overrides.output_tokens !== undefined ? overrides.output_tokens : 20,
    cache_read_tokens: overrides.cache_read_tokens !== undefined ? overrides.cache_read_tokens : 0,
    cache_write_tokens: overrides.cache_write_tokens !== undefined ? overrides.cache_write_tokens : 0,
    input_cost_usd: overrides.input_cost_usd !== undefined ? overrides.input_cost_usd : 0.001,
    output_cost_usd: overrides.output_cost_usd !== undefined ? overrides.output_cost_usd : 0.002,
    total_cost_usd: overrides.total_cost_usd !== undefined ? overrides.total_cost_usd : 0.003,
    error_code: overrides.error_code !== undefined ? overrides.error_code : null,
    error_detail: overrides.error_detail !== undefined ? overrides.error_detail : null,
    last_event_sequence_index:
      overrides.last_event_sequence_index !== undefined ? overrides.last_event_sequence_index : 0,
    created_at: overrides.created_at ?? "2026-02-15T10:00:00Z",
    completed_at: overrides.completed_at !== undefined ? overrides.completed_at : "2026-02-15T10:00:01Z",
    steps: overrides.steps ?? [],
    tool_calls: overrides.tool_calls ?? [],
    change_items: overrides.change_items ?? []
  };
}
