import { describe, expect, it } from "vitest";

import { buildChangeItem, buildRun } from "../../test/factories/agent";
import { buildThreadReviewItems } from "../agent/review/model";
import { groupReviewItemsByChangeType } from "./helpers";
import { mapThreadReviewItemsToReviewItems } from "./mapThreadReviewItem";

describe("groupReviewItemsByChangeType", () => {
  it("orders entity proposals before entries", () => {
    const entry = buildChangeItem({
      id: "entry-1",
      change_type: "create_entry",
      payload_json: {
        kind: "EXPENSE",
        date: "2026-01-01",
        name: "Lunch",
        amount_minor: 100,
        from_entity: "A",
        to_entity: "B",
        tags: []
      }
    });
    const entity = buildChangeItem({
      id: "entity-1",
      change_type: "create_entity",
      payload_json: { name: "Cafe", category: "merchant" }
    });
    const run = buildRun({ change_items: [entry, entity] });
    const groups = groupReviewItemsByChangeType(mapThreadReviewItemsToReviewItems(buildThreadReviewItems([run])));
    expect(groups.map((group) => group.key)).toEqual(["entity", "entry"]);
  });
});
