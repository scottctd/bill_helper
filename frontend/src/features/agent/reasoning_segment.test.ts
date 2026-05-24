import { describe, expect, it } from "vitest";

import {
  estimateReasoningTokenCount,
  formatThinkingSummaryLabel,
  formatThoughtSummaryLabel,
  isModelReasoningSource,
  tailReasoningLines
} from "./reasoning_segment";

describe("reasoning_segment helpers", () => {
  it("estimates token count from message length", () => {
    expect(estimateReasoningTokenCount("abcd")).toBe(1);
    expect(estimateReasoningTokenCount("Checking entities before proposing changes.")).toBe(11);
    expect(estimateReasoningTokenCount("   ")).toBe(0);
  });

  it("formats summary labels with duration and tokens", () => {
    expect(formatThoughtSummaryLabel({ durationMs: 2500, tokenCount: 412 })).toBe(
      "Thought for 3s · 412 tokens"
    );
    expect(formatThoughtSummaryLabel({ durationMs: null, tokenCount: 8 })).toBe("Thought · 8 tokens");
  });

  it("formats live thinking labels with duration and tokens", () => {
    expect(formatThinkingSummaryLabel({ durationMs: 2500, tokenCount: 412 })).toBe(
      "Thinking for 3s · 412 tokens"
    );
    expect(formatThinkingSummaryLabel({ durationMs: 500, tokenCount: 0 })).toBe("Thinking for 1s · 0 tokens");
  });

  it("detects model reasoning source", () => {
    expect(isModelReasoningSource("model_reasoning")).toBe(true);
    expect(isModelReasoningSource("tool_call")).toBe(false);
  });

  it("keeps only the trailing reasoning lines for live streaming", () => {
    const reasoning = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n");
    expect(tailReasoningLines(reasoning)).toBe(
      ["line-4", "line-5", "line-6", "line-7", "line-8", "line-9", "line-10", "line-11", "line-12"].join("\n")
    );
    expect(tailReasoningLines("short reasoning")).toBe("short reasoning");
  });
});
