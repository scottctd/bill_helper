import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { GroupRuleEditorPanel } from "./GroupRuleEditorPanel";
import { createExistingEditorSession, updateSessionFormState } from "./groupRuleEditorState";
import type { GroupRead, Tag } from "../../lib/types";

const tags: Tag[] = [
  { id: 1, name: "grocery", color: "#33aa66", entry_count: 0 },
  { id: 2, name: "coffee", color: "#aa6633", entry_count: 0 },
  { id: 3, name: "housing", color: "#4466cc", entry_count: 0 }
];

function createRuleGroup(rule: GroupRead["rule"]): GroupRead {
  return {
    id: "group-1",
    name: "Routine",
    description: "Regular spending.",
    color: "#64748b",
    source: "rule",
    position: 0,
    member_count: 0,
    first_occurred_at: null,
    last_occurred_at: null,
    members: [],
    rule,
    rule_summary: "kind is expense",
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z"
  };
}

function ControlledEditor({ group }: { group: GroupRead }) {
  const [session, setSession] = useState(() => createExistingEditorSession(group));

  return (
    <MemoryRouter>
      <GroupRuleEditorPanel
        session={session}
        tags={tags}
        preferredTagName={tags[0]?.name}
        isDirty={JSON.stringify(session.formState) !== JSON.stringify(session.baselineState)}
        isPending={false}
        canSubmit={false}
        submitLabel="Save changes"
        submitPendingLabel="Saving..."
        onSubmit={() => {}}
        onChange={(nextFormState) => setSession((current) => updateSessionFormState(current, nextFormState))}
      />
    </MemoryRouter>
  );
}

describe("GroupRuleEditorPanel", () => {
  it("uses the shared tag multi-select and renders save in the panel header", async () => {
    const user = userEvent.setup();
    const group = createRuleGroup({
      include: {
        type: "group",
        operator: "AND",
        children: [{ type: "condition", field: "tags", operator: "has_any", value: ["grocery"] }]
      },
      exclude: null
    });

    render(<ControlledEditor group={group} />);

    expect(screen.queryByText("All conditions")).not.toBeInTheDocument();
    expect(screen.queryByText("Any condition")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "AND" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.click(screen.getByLabelText("Rule tags"));
    await user.type(screen.getByLabelText("Rule tags"), "coffee");
    await user.click(await screen.findByRole("button", { name: /coffee/i }));

    expect(screen.getByDisplayValue("Routine")).toBeInTheDocument();
  });

  it("opens nested rules in advanced mode and keeps guided mode locked", () => {
    const nestedRule: GroupRead["rule"] = {
      include: {
        type: "group",
        operator: "AND",
        children: [
          { type: "condition", field: "entry_kind", operator: "is", value: "EXPENSE" },
          {
            type: "group",
            operator: "OR",
            children: [
              { type: "condition", field: "tags", operator: "has_any", value: ["grocery"] },
              { type: "condition", field: "is_internal_transfer", operator: "is", value: true }
            ]
          }
        ]
      },
      exclude: null
    };

    render(<ControlledEditor group={createRuleGroup(nestedRule)} />);

    expect(screen.getByRole("button", { name: "Guided" })).toBeDisabled();
    expect(screen.getByText(/guided mode stays locked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
