import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as copyModule from "../../lib/copyToClipboard";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  it("copies the provided text and shows copied feedback", async () => {
    const user = userEvent.setup();
    vi.spyOn(copyModule, "copyTextToClipboard").mockResolvedValue(true);

    render(<CopyButton text="model request failed" label="Copy code" copiedLabel="Code copied" showLabel />);

    const button = screen.getByRole("button", { name: "Copy code" });
    await user.click(button);

    expect(copyModule.copyTextToClipboard).toHaveBeenCalledWith("model request failed");
    expect(screen.getByRole("button", { name: "Code copied" })).toHaveTextContent("Code copied");
  });
});
