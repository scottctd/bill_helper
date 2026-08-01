import { describe, expect, it } from "vitest";

import type { AgentThreadDetail } from "../../../lib/types";
import { buildRun, buildTurn } from "../../../test/factories/agent";
import { buildAgentThreadDebugTranscript } from "./threadDebugTranscript";

describe("buildAgentThreadDebugTranscript", () => {
  it("includes readable messages, run diagnostics, the thread identifier, and raw detail", () => {
    const detail: AgentThreadDetail = {
      thread: {
        id: "thread-debug-1",
        title: "Broken import",
        summary: "Investigate a failed import",
        created_at: "2026-07-31T10:00:00Z",
        updated_at: "2026-07-31T10:05:00Z",
        initiated_by_external_agent: false
      },
      configured_model_name: "gpt-test",
      current_context_tokens: 42,
      turns: [
        buildTurn({
          run_id: "run-debug-1",
          user_message: {
            id: "message-user-1",
            role: "user",
            content_markdown: "Import these entries",
            raw_prompt_markdown: "Import these entries with the attached context",
            reasoning_text: null,
            created_at: "2026-07-31T10:01:00Z",
            attachments: []
          },
          assistant_message: {
            id: "message-assistant-1",
            role: "assistant",
            content_markdown: "The import failed.",
            reasoning_text: "The tool returned an error.",
            created_at: "2026-07-31T10:02:00Z",
            attachments: []
          }
        })
      ],
      runs: [
        buildRun({
          id: "run-debug-1",
          thread_id: "thread-debug-1",
          status: "failed",
          error_code: "tool_error",
          error_detail: "Import validation failed"
        })
      ]
    };

    const transcript = buildAgentThreadDebugTranscript(detail);

    expect(transcript).toContain("Thread ID: thread-debug-1");
    expect(transcript).toContain("Import these entries");
    expect(transcript).toContain("Raw prompt:");
    expect(transcript).toContain("The tool returned an error.");
    expect(transcript).toContain("Error code: tool_error");
    expect(transcript).toContain('"error_detail": "Import validation failed"');
  });

  it("returns empty text when no persisted thread is selected", () => {
    expect(buildAgentThreadDebugTranscript(undefined)).toBe("");
  });
});
