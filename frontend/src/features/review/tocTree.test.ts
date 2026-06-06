import { describe, expect, it } from "vitest";

import { buildChangeItem, buildRun } from "../../test/factories/agent";
import { buildThreadReviewItems } from "../agent/review/model";
import { mapThreadReviewItemsToReviewItems } from "./mapThreadReviewItem";
import { buildReviewTocTree } from "./tocTree";
import type { ReviewItemView } from "./types";

function buildEntryItem(overrides: Partial<ReviewItemView> & Pick<ReviewItemView, "id" | "entryName" | "entryToEntity">): ReviewItemView {
  return {
    changeType: "create_entry",
    title: `Create Entry: ${overrides.entryName}`,
    kicker: "Create Entry",
    status: "PENDING_REVIEW",
    fields: null,
    isPending: true,
    isResolved: false,
    tocMeta: "Run 1",
    ...overrides
  };
}

describe("buildReviewTocTree", () => {
  it("nests status, proposal type, and entry destination groups", () => {
    const items = mapThreadReviewItemsToReviewItems(
      buildThreadReviewItems([
        buildRun({
          change_items: [
            buildChangeItem({
              id: "entry-b",
              change_type: "create_entry",
              payload_json: {
                kind: "EXPENSE",
                date: "2026-01-02",
                name: "Brunch",
                amount_minor: 2000,
                from_entity: "Checking",
                to_entity: "Cafe",
                tags: []
              }
            }),
            buildChangeItem({
              id: "entry-a",
              change_type: "create_entry",
              payload_json: {
                kind: "EXPENSE",
                date: "2026-01-01",
                name: "Breakfast",
                amount_minor: 1000,
                from_entity: "Checking",
                to_entity: "Cafe",
                tags: []
              }
            }),
            buildChangeItem({
              id: "entity-1",
              change_type: "create_entity",
              payload_json: { name: "Cafe", category: "merchant" }
            })
          ]
        })
      ])
    );

    const tree = buildReviewTocTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe("Pending");
    expect(tree[0]?.typeGroups.map((group) => group.key)).toEqual(["entity", "entry"]);

    const entryGroup = tree[0]?.typeGroups.find((group) => group.key === "entry");
    expect(entryGroup?.destinationGroups).toHaveLength(1);
    expect(entryGroup?.destinationGroups?.[0]?.label).toBe("Cafe");
    expect(entryGroup?.destinationGroups?.[0]?.items.map((item) => item.entryName)).toEqual(["Breakfast", "Brunch"]);
  });

  it("splits pending and resolved at the top level", () => {
    const pending = buildEntryItem({
      id: "pending-entry",
      entryName: "Lunch",
      entryToEntity: "Cafe"
    });
    const resolved = buildEntryItem({
      id: "resolved-entry",
      entryName: "Dinner",
      entryToEntity: "Bistro",
      status: "REJECTED",
      isPending: false,
      isResolved: true
    });

    const tree = buildReviewTocTree([pending, resolved]);
    expect(tree.map((section) => section.label)).toEqual(["Pending", "Reviewed / Failed"]);
    expect(tree[0]?.count).toBe(1);
    expect(tree[1]?.count).toBe(1);
  });
});
