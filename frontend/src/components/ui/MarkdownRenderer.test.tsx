import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders a copy button for fenced code blocks", () => {
    render(<MarkdownRenderer markdown={"```\nline one\nline two\n```"} />);

    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    expect(screen.getByText(/line one/)).toBeInTheDocument();
  });
});
