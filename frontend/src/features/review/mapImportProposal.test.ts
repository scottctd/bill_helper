import { describe, expect, it } from "vitest";

import { mapImportProposalToReviewItem } from "./mapImportProposal";

describe("mapImportProposalToReviewItem", () => {
  it("maps source files into clickable header metadata links", () => {
    const item = mapImportProposalToReviewItem({
      canonical_change_item_id: "proposal-1",
      change_type: "create_entity",
      status: "PENDING_REVIEW",
      payload_json: { name: "PC Financial", category: "financial_institution" },
      source_task_ids: ["task-1", "task-2"],
      source_task_labels: ["Preferred_Package_4881_060626.csv", "Scene_Visa_card_4017_060626.csv"],
      duplicate_count: 3
    });

    expect(item.title).toBe("PC Financial");
    expect(item.cardMetadata).toEqual([
      { key: "Type", value: "Create Entity" },
      { key: "Status", value: "PENDING_REVIEW" },
      {
        key: "Source",
        value: "Preferred_Package_4881_060626.csv, Scene_Visa_card_4017_060626.csv",
        links: [
          { taskId: "task-1", label: "Preferred_Package_4881_060626.csv" },
          { taskId: "task-2", label: "Scene_Visa_card_4017_060626.csv" }
        ]
      }
    ]);
    expect(item.context?.map((line) => line.text)).toEqual([
      "3 identical proposals were merged into this canonical item."
    ]);
  });

  it("omits duplicate context when count is one", () => {
    const item = mapImportProposalToReviewItem({
      canonical_change_item_id: "proposal-2",
      change_type: "create_entity",
      status: "PENDING_REVIEW",
      payload_json: { name: "PC Financial", category: "financial_institution" },
      source_task_ids: ["task-1"],
      source_task_labels: ["Preferred_Package_4881_060626.csv"],
      duplicate_count: 1
    });

    expect(item.context).toEqual([]);
  });
});
