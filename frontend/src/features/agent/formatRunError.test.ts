import { describe, expect, it } from "vitest";

import { formatAgentRunErrorMarkdown } from "./formatRunError";

describe("formatAgentRunErrorMarkdown", () => {
  it("wraps trimmed error text in a fenced code block", () => {
    expect(formatAgentRunErrorMarkdown("  Run interrupted by user.  ")).toBe(
      "```\nRun interrupted by user.\n```"
    );
  });

  it("returns empty string for blank input", () => {
    expect(formatAgentRunErrorMarkdown("   ")).toBe("");
  });
});
