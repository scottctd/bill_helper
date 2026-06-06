import { describe, expect, it } from "vitest";

import { buildChangeItem, buildRun } from "../../test/factories/agent";
import { buildThreadReviewItems } from "../agent/review/model";
import { mapThreadReviewItemToReviewItemView } from "./mapThreadReviewItem";

describe("mapThreadReviewItemToReviewItemView", () => {
  it("uses resource name title and base card metadata only", () => {
    const [reviewItem] = buildThreadReviewItems([
      buildRun({
        change_items: [
          buildChangeItem({
            id: "change-1",
            change_type: "create_entity",
            payload_json: { name: "Molly Tea", category: "merchant" }
          })
        ]
      })
    ]);

    const item = mapThreadReviewItemToReviewItemView(reviewItem);

    expect(item.title).toBe("Molly Tea");
    expect(item.cardMetadata).toEqual([
      { key: "Type", value: "Create Entity" },
      { key: "Status", value: "PENDING_REVIEW" }
    ]);
  });
});
