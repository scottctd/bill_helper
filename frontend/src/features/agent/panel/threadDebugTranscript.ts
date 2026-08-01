/**
 * CALLING SPEC:
 * - Purpose: serialize one agent thread into a readable diagnostic transcript plus its raw API detail.
 * - Inputs: the selected `AgentThreadDetail`.
 * - Outputs: plain text suitable for clipboard sharing during debugging.
 * - Side effects: none.
 */
import type { AgentRun, AgentThreadDetail, AgentTurnMessage } from "../../../lib/types";

function appendMessage(lines: string[], label: string, message: AgentTurnMessage | null | undefined) {
  lines.push(label);
  if (!message) {
    lines.push("(missing)", "");
    return;
  }

  lines.push(`Message ID: ${message.id}`, `Created at: ${message.created_at}`, "", message.content_markdown || "(empty)");
  if (message.raw_prompt_markdown && message.raw_prompt_markdown !== message.content_markdown) {
    lines.push("", "Raw prompt:", message.raw_prompt_markdown);
  }
  if (message.reasoning_text) {
    lines.push("", "Reasoning:", message.reasoning_text);
  }
  lines.push("");
}

function appendRunSummary(lines: string[], run: AgentRun | undefined) {
  if (!run) {
    lines.push("Run diagnostics: (missing)", "");
    return;
  }

  lines.push(
    "Run diagnostics:",
    `Run ID: ${run.id}`,
    `Status: ${run.status}`,
    `Model: ${run.model_name}`,
    `Origin: ${run.origin}`,
    `Approval policy: ${run.approval_policy}`,
    `Input tokens: ${run.input_tokens ?? "unknown"}`,
    `Output tokens: ${run.output_tokens ?? "unknown"}`,
    `Total cost USD: ${run.total_cost_usd ?? "unknown"}`
  );
  if (run.error_code || run.error_detail) {
    lines.push(`Error code: ${run.error_code ?? "unknown"}`, `Error detail: ${run.error_detail ?? "unknown"}`);
  }
  lines.push("");
}

export function buildAgentThreadDebugTranscript(detail: AgentThreadDetail | undefined): string {
  if (!detail) {
    return "";
  }

  const runById = new Map(detail.runs.map((run) => [run.id, run]));
  const lines = [
    "AGENT THREAD DEBUG EXPORT",
    "=========================",
    `Thread ID: ${detail.thread.id}`,
    `Title: ${detail.thread.title ?? "Untitled thread"}`,
    `Summary: ${detail.thread.summary ?? "(none)"}`,
    `Created at: ${detail.thread.created_at}`,
    `Updated at: ${detail.thread.updated_at}`,
    `Initiated by external agent: ${detail.thread.initiated_by_external_agent ? "yes" : "no"}`,
    `Configured model: ${detail.configured_model_name}`,
    `Current context tokens: ${detail.current_context_tokens ?? "unknown"}`,
    "",
    "READABLE TRANSCRIPT",
    "==================="
  ];

  if (detail.turns.length === 0) {
    lines.push("(no persisted turns)", "");
  }

  detail.turns.forEach((turn) => {
    lines.push(`TURN ${turn.turn_index + 1}`, "------", `Status: ${turn.status}`, "");
    appendMessage(lines, "USER", turn.user_message);
    appendMessage(lines, "ASSISTANT", turn.assistant_message);
    appendRunSummary(lines, runById.get(turn.run_id));
  });

  lines.push("RAW THREAD DETAIL JSON", "======================", JSON.stringify(detail, null, 2));
  return lines.join("\n").trim();
}
