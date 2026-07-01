import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TagMultiSelect, compactTagMultiSelectLabel } from "./TagMultiSelect";
import type { Tag } from "../lib/types";

const options: Tag[] = [
  { id: 1, name: "coffee", color: null, entry_count: 0 },
  { id: 2, name: "cafe", color: null, entry_count: 0 },
  { id: 3, name: "caffeine", color: null, entry_count: 0 },
  { id: 4, name: "tea", color: null, entry_count: 0 }
];

function optionLabels() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".tag-multiselect-option")).map((option) =>
    option.textContent?.replace(/\s+/g, " ").trim()
  );
}

describe("TagMultiSelect", () => {
  it("shows compact summary labels", () => {
    expect(compactTagMultiSelectLabel([], "All tags")).toEqual({ text: "All tags", isPlaceholder: true });
    expect(compactTagMultiSelectLabel(["food"], "All tags")).toEqual({ text: "food", isPlaceholder: false });
    expect(compactTagMultiSelectLabel(["food", "travel"], "All tags")).toEqual({
      text: "food +1",
      isPlaceholder: false
    });
  });

  it("renders compact mode without inline chips", () => {
    render(
      <TagMultiSelect
        options={options}
        value={["coffee", "tea"]}
        onChange={() => {}}
        ariaLabel="Tags"
        placeholder="All tags"
        displayMode="compact"
      />
    );

    expect(screen.getByRole("button", { name: "Tags" })).toHaveTextContent("coffee +1");
    expect(document.querySelector(".tag-chip")).not.toBeInTheDocument();
  });

  it("shows fuzzy matches and ranks the tightest matches first", async () => {
    const user = userEvent.setup();

    render(<TagMultiSelect options={options} value={[]} onChange={() => {}} ariaLabel="Tags" />);

    await user.type(screen.getByLabelText("Tags"), "cfe");

    expect(optionLabels().slice(0, 3)).toEqual(["cafe", "coffee", "caffeine"]);
    expect(screen.queryByText("No matching tags.")).not.toBeInTheDocument();
  });

  it("adds the top fuzzy match first when submitting from the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagMultiSelect options={options} value={[]} onChange={onChange} ariaLabel="Tags" />);

    await user.type(screen.getByLabelText("Tags"), "cfe{enter}");

    expect(onChange).toHaveBeenLastCalledWith(["cafe"]);
  });
});
