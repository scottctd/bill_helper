import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { buildChangeItem, buildRun } from "../../../test/factories/agent";
import { listOrEmpty } from "../../../lib/collections";
import { renderWithQueryClient } from "../../../test/renderWithQueryClient";
import { AgentThreadReviewModal } from "./AgentThreadReviewModal";
import type { AgentThreadReviewModalProps } from "./modalTypes";

function buildReviewModalProps(overrides: Partial<AgentThreadReviewModalProps> = {}): AgentThreadReviewModalProps {
  return {
    open: true,
    threadId: "thread-1",
    runs: [],
    onOpenChange: vi.fn(),
    onApproveItem: vi.fn(),
    onRejectItem: vi.fn(),
    onReopenItem: vi.fn(),
    onBatchApproveItems: vi.fn().mockResolvedValue({
      items: [],
      summary: { succeeded: 0, failed: 0, failedItemIds: [] }
    }),
    onBatchRejectItems: vi.fn().mockResolvedValue({
      items: [],
      summary: { succeeded: 0, failed: 0, failedItemIds: [] }
    }),
    ...overrides
  };
}

describe("AgentThreadReviewModal", () => {
  it("renders pending and resolved sections and lets the user navigate from the toc", async () => {
    const pendingRun = buildRun({
      id: "run-pending",
      created_at: "2026-03-06T10:00:00Z",
      change_items: [
        buildChangeItem({
          id: "change-pending",
          run_id: "run-pending",
          change_type: "create_entry",
          payload_json: {
            kind: "EXPENSE",
            date: "2026-03-05",
            name: "Lunch",
            amount_minor: 1200,
            currency_code: "USD",
            from_entity: "Main Checking",
            to_entity: "Cafe",
            tags: ["food"]
          }
        }),
        buildChangeItem({
          id: "change-pending-account",
          run_id: "run-pending",
          change_type: "create_account",
          payload_json: {
            name: "Savings Vault",
            currency_code: "USD",
            is_active: true,
            markdown_body: "Savings notes"
          }
        }),
        buildChangeItem({
          id: "change-pending-tag",
          run_id: "run-pending",
          change_type: "create_tag",
          payload_json: {
            name: "travel",
            type: "trip"
          }
        })
      ]
    });
    const resolvedRun = buildRun({
      id: "run-resolved",
      created_at: "2026-03-06T10:05:00Z",
      change_items: [
        buildChangeItem({
          id: "change-resolved",
          run_id: "run-resolved",
          change_type: "delete_tag",
          status: "REJECTED",
          payload_json: {
            name: "groceries",
            target: {
              name: "groceries"
            }
          }
        })
      ]
    });

    renderWithQueryClient(
      <AgentThreadReviewModal
        {...buildReviewModalProps({
          runs: [pendingRun, resolvedRun]
        })}
      />
    );

    expect(await screen.findByText("Thread review")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Reviewed / Failed")).toBeInTheDocument();
    expect(screen.queryByText(/Review proposals across the whole thread/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("PENDING_REVIEW")).toHaveLength(1);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("w-[96vw]", "max-w-none", "xl:w-[78rem]", "p-0");

    const controlsBar = dialog.querySelector(".agent-review-controls-bar");
    expect(controlsBar).not.toBeNull();
    expect(within(controlsBar as HTMLElement).getByRole("button", { name: "Approve All" })).toBeInTheDocument();
    expect(within(controlsBar as HTMLElement).getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(within(controlsBar as HTMLElement).getByRole("button", { name: "Hide list" })).toHaveAttribute("aria-expanded", "true");

    const sidebar = dialog.querySelector(".agent-review-sidebar");
    expect(sidebar).not.toBeNull();
    expect(within(sidebar as HTMLElement).queryByRole("button", { name: "Approve All" })).not.toBeInTheDocument();
    const pendingSection = within(sidebar as HTMLElement).getByLabelText("Pending");
    expect(within(pendingSection).getByText("Accounts")).toBeInTheDocument();
    expect(within(pendingSection).getByText("Tags")).toBeInTheDocument();
    expect(within(pendingSection).getByText("Entries")).toBeInTheDocument();
    expect(within(sidebar as HTMLElement).queryByText("REJECTED")).not.toBeInTheDocument();
    expect(within(sidebar as HTMLElement).getByLabelText("Rejected")).toBeInTheDocument();
    expect(dialog.querySelector(".agent-review-sidebar-scroll")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Savings Vault" })).toBeInTheDocument();
    const fieldList = screen.getByLabelText("Proposal fields");
    expect(within(fieldList).getByText("Currency")).toBeInTheDocument();
    expect(within(fieldList).getByText("USD")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide list" }));
    expect(screen.getByRole("button", { name: "Show list" })).toHaveAttribute("aria-expanded", "false");
    expect(dialog.querySelector(".agent-review-sidebar")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show list" }));
    expect(await screen.findByRole("button", { name: "Hide list" })).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(screen.getByText("groceries"));

    expect(screen.getByRole("heading", { name: "groceries" })).toBeInTheDocument();
    expect(screen.getAllByText("REJECTED").length).toBeGreaterThan(0);
  });

  it("auto-advances to the next pending proposal after approval", async () => {
    const firstRun = buildRun({
      id: "run-1",
      created_at: "2026-03-06T10:00:00Z",
      change_items: [
        buildChangeItem({
          id: "change-1",
          run_id: "run-1",
          change_type: "create_tag",
          payload_json: {
            name: "subscriptions",
            type: "recurring"
          }
        }),
        buildChangeItem({
          id: "change-2",
          run_id: "run-1",
          change_type: "create_entity",
          payload_json: {
            name: "Molly Tea",
            category: "merchant"
          }
        })
      ]
    });
    const onApproveItem = vi
      .fn()
      .mockResolvedValueOnce({
        ...listOrEmpty(firstRun.change_items)[1],
        status: "APPLIED",
        applied_resource_type: "entity",
        applied_resource_id: "entity-1"
      });

    renderWithQueryClient(
      <AgentThreadReviewModal
        {...buildReviewModalProps({
          runs: [firstRun],
          onApproveItem
        })}
      />
    );

    expect(await screen.findByRole("heading", { name: "Molly Tea" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "subscriptions" })).toBeInTheDocument());
    expect(onApproveItem).toHaveBeenCalledWith({ itemId: "change-2" });
  });

  it("renders compact read-only fields for group membership proposals", async () => {
    const run = buildRun({
      id: "run-group",
      created_at: "2026-03-06T10:00:00Z",
      change_items: [
        buildChangeItem({
          id: "proposal-group-create",
          run_id: "run-group",
          change_type: "create_group",
          payload_json: {
            name: "Monthly Bills",
            source: "manual"
          }
        }),
        buildChangeItem({
          id: "proposal-group-member",
          run_id: "run-group",
          change_type: "create_group_member",
          payload_json: {
            action: "add",
            group_ref: {
              create_group_proposal_id: "proposal-group-create"
            },
            target: {
              target_type: "entry",
              entry_ref: {
                entry_id: "entry-1234"
              },
              override: "include"
            },
            group_preview: {
              name: "Monthly Bills",
              group_source: "manual"
            },
            member_preview: {
              date: "2026-03-01",
              kind: "EXPENSE",
              name: "March Rent",
              amount_minor: 250000,
              currency_code: "USD",
              from_entity: "Main Checking",
              to_entity: "Landlord",
              tags: ["housing"],
              markdown_notes: "Statement imported"
            }
          }
        })
      ]
    });

    renderWithQueryClient(
      <AgentThreadReviewModal
        {...buildReviewModalProps({
          runs: [run]
        })}
      />
    );

    const dialog = await screen.findByRole("dialog");
    const pendingSection = within(dialog.querySelector(".agent-review-sidebar") as HTMLElement).getByLabelText("Pending");
    expect(within(pendingSection).getByText("Groups")).toBeInTheDocument();
    const initialFields = screen.getByLabelText("Proposal fields");
    expect(within(initialFields).getByText("Source")).toBeInTheDocument();
    expect(within(initialFields).getByText("manual")).toBeInTheDocument();

    await userEvent.click(screen.getByText("March Rent"));

    expect(screen.getByRole("heading", { name: "March Rent" })).toBeInTheDocument();
    const memberFields = screen.getByLabelText("Proposal fields");
    expect(within(memberFields).getByText("Group")).toBeInTheDocument();
    expect(within(memberFields).getByText("Monthly Bills")).toBeInTheDocument();
    expect(within(memberFields).getByText("Override")).toBeInTheDocument();
    expect(within(memberFields).getByText("include")).toBeInTheDocument();
  });

  it("shows update proposals as before → after field rows", async () => {
    const run = buildRun({
      id: "run-update",
      created_at: "2026-03-06T10:00:00Z",
      change_items: [
        buildChangeItem({
          id: "proposal-update",
          run_id: "run-update",
          change_type: "update_entity",
          payload_json: {
            name: "Molly Tea",
            current: { name: "Molly Tea", category: "merchant" },
            patch: { category: "cafe" }
          }
        })
      ]
    });

    renderWithQueryClient(
      <AgentThreadReviewModal
        {...buildReviewModalProps({
          runs: [run]
        })}
      />
    );

    expect(await screen.findByRole("heading", { name: "Molly Tea" })).toBeInTheDocument();
    expect(document.querySelector(".agent-review-summary")?.textContent).toContain("category merchant → cafe");

    const detailsSection = screen.getByRole("heading", { name: "Details" }).closest("section") as HTMLElement;
    const detailsFields = within(detailsSection).getByLabelText("Proposal fields");
    expect(within(detailsFields).getByText("merchant")).toBeInTheDocument();
    expect(within(detailsFields).getByText("cafe")).toBeInTheDocument();
  });

  it("uses one batch approve call for Approve All", async () => {
    const run = buildRun({
      id: "run-batch",
      created_at: "2026-03-06T10:00:00Z",
      change_items: [
        buildChangeItem({
          id: "change-1",
          run_id: "run-batch",
          change_type: "create_entry",
          payload_json: {
            kind: "EXPENSE",
            date: "2026-03-05",
            name: "Lunch",
            amount_minor: 1200,
            from_entity: "Main Checking",
            to_entity: "Cafe"
          }
        }),
        buildChangeItem({
          id: "change-2",
          run_id: "run-batch",
          change_type: "create_entry",
          payload_json: {
            kind: "EXPENSE",
            date: "2026-03-05",
            name: "Coffee",
            amount_minor: 500,
            from_entity: "Main Checking",
            to_entity: "Cafe"
          }
        })
      ]
    });
    const onBatchApproveItems = vi.fn().mockResolvedValue({
      items: listOrEmpty(run.change_items).map((item) => ({ ...item, status: "APPLIED" as const })),
      summary: { succeeded: 2, failed: 0, failedItemIds: [] }
    });

    renderWithQueryClient(
      <AgentThreadReviewModal
        {...buildReviewModalProps({
          runs: [run],
          onBatchApproveItems
        })}
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: "Approve All" }));

    await waitFor(() => expect(onBatchApproveItems).toHaveBeenCalledTimes(1));
    expect(onBatchApproveItems).toHaveBeenCalledWith({
      threadId: "thread-1",
      items: [{ itemId: "change-1" }, { itemId: "change-2" }]
    });
  });
});
