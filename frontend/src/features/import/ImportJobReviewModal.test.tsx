import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { listImportJobProposals } from "../../lib/api";
import { renderWithQueryClient } from "../../test/renderWithQueryClient";
import { ImportJobReviewModal } from "./ImportJobReviewModal";

vi.mock("../../lib/api", () => ({
  listImportJobProposals: vi.fn(),
  batchApproveImportJobProposals: vi.fn(),
  batchRejectImportJobProposals: vi.fn()
}));

describe("ImportJobReviewModal", () => {
  it("renders aggregated review with entity proposals", async () => {
    vi.mocked(listImportJobProposals).mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        canonical_change_item_id: `proposal-${index}`,
        change_type: "create_entity",
        status: "PENDING_REVIEW",
        payload_json: { name: `Entity ${index}`, category: "merchant" },
        source_task_ids: [`task-${index}`],
        source_task_labels: ["Scene_Visa_card_4017_060626.csv"],
        duplicate_count: 1
      }))
    );

    renderWithQueryClient(
      <ImportJobReviewModal
        open
        jobId="job-1"
        jobTitle="Import Preferred_Package_4881_060626.csv +1"
        onOpenChange={vi.fn()}
        onMutationComplete={vi.fn()}
      />
    );

    expect(await screen.findByRole("button", { name: /Entity 0/ })).toBeInTheDocument();
    expect(screen.getAllByText("merchant").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Entities")).toBeInTheDocument();
  });
});
