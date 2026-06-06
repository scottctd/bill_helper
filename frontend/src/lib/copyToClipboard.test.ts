import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./copyToClipboard";

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false for blank text", async () => {
    await expect(copyTextToClipboard("   ")).resolves.toBe(false);
  });

  it("writes trimmed text through the async clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("  hello  ")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });
});
