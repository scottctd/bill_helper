import type { ComponentProps } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntryEditorModal } from "./EntryEditorModal";
import type { Entry, EntryTagSuggestionResponse } from "../lib/types";
import { suggestEntryTags } from "../lib/api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    suggestEntryTags: vi.fn(),
  };
});

vi.mock("./MarkdownBlockEditor", () => ({
  MarkdownBlockEditor: () => <div data-testid="markdown-editor" />
}));

const entryFixture: Entry = {
  id: "entry-1",
  kind: "EXPENSE",
  occurred_at: "2026-03-05",
  name: "Coffee",
  amount_minor: 575,
  currency_code: "CAD",
  from_entity_id: null,
  to_entity_id: "entity-2",
  owner_user_id: "user-1",
  from_entity: "Checking",
  from_entity_missing: true,
  to_entity: "Cafe",
  to_entity_missing: false,
  owner: "Alice",
  markdown_body: null,
  lifecycle: null,
  category: null,
  created_at: "2026-03-05T00:00:00Z",
  updated_at: "2026-03-05T00:00:00Z",
  groups: [],
  tags: []
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderModal(overrides: Partial<ComponentProps<typeof EntryEditorModal>> = {}) {
  return renderWithQueryClient(
    <EntryEditorModal
      isOpen
      mode="edit"
      entry={entryFixture}
      currencies={[{ code: "CAD", name: "Canadian Dollar", entry_count: 1, is_placeholder: false }]}
      entities={[{ id: "entity-2", name: "Cafe", category: "Food", is_account: false, from_count: 0, to_count: 1, account_count: 0, entry_count: 1 }]}
      groups={[]}
      tags={[
        { id: 1, name: "coffee", color: "#5f6caf", description: "Coffee purchases" },
        { id: 2, name: "grocery", color: "#7c9a4d", description: "Groceries" }
      ]}
      categoryTerms={[]}
      currentUserId="user-1"
      defaultCurrencyCode="CAD"
      entryTaggingModel={null}
      isSaving={false}
      onClose={() => {}}
      onSubmit={() => {}}
      {...overrides}
    />
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("EntryEditorModal", () => {
  it("renders the markdown editor under a Notes field label", async () => {
    renderModal();

    const notesLabel = await screen.findByText("Notes:");
    expect(notesLabel).toBeInTheDocument();
    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(notesLabel.closest(".entry-property-line")?.querySelector("[data-testid='markdown-editor']")).not.toBeNull();
  });

  it("explains preserved missing-entity labels while editing", async () => {
    renderModal();

    expect(await screen.findByText(/preserved labels remain visible/i)).toBeInTheDocument();
  });

  it("keeps category searchable and lifecycle as a basic non-searchable select", async () => {
    const user = userEvent.setup();

    renderModal({
      entry: {
        ...entryFixture,
        category: "food_drink/dining_out",
        lifecycle: "day_to_day"
      },
      categoryTerms: [
        {
          id: "category-food",
          taxonomy_id: "entry-category",
          name: "food_drink",
          normalized_name: "food_drink",
          parent_term_id: null,
          usage_count: 1
        },
        {
          id: "category-dining",
          taxonomy_id: "entry-category",
          name: "dining_out",
          normalized_name: "dining_out",
          parent_term_id: "category-food",
          default_lifecycle: "day_to_day",
          usage_count: 1
        }
      ]
    });

    const categoryControl = screen.getByRole("button", { name: "Category" });
    const lifecycleControl = screen.getByRole("button", { name: "Lifecycle" });
    expect(categoryControl.querySelector(".single-select-tone-label")).not.toBeNull();
    expect(categoryControl.querySelector(".single-select-tone-pill")).toBeNull();
    expect(lifecycleControl.querySelector(".single-select-tone-label")).not.toBeNull();
    expect(lifecycleControl.querySelector(".single-select-tone-pill")).toBeNull();

    await user.click(categoryControl);
    const categorySearch = screen.getByRole("textbox", { name: "Search categories..." });
    expect(categorySearch).toBeInTheDocument();
    expect(categorySearch.closest(".floating-menu-portal-host")).not.toBeNull();
    const categoryOption = screen.getByRole("option", { name: "food_drink / dining_out" });
    expect(categoryOption).toBeInTheDocument();
    expect(categoryOption.querySelector(".select-option-tone-dot")).not.toBeNull();
    expect(categoryOption.querySelector(".single-select-tone-pill")).toBeNull();

    await user.click(lifecycleControl);
    expect(screen.queryByRole("textbox", { name: "Search categories..." })).not.toBeInTheDocument();
    const lifecycleOption = screen.getByRole("option", { name: "day-to-day" });
    expect(lifecycleOption).toBeInTheDocument();
    expect(lifecycleOption.querySelector(".select-option-tone-dot")).not.toBeNull();
    expect(lifecycleOption.querySelector(".single-select-tone-pill")).toBeNull();
  });

  it("hosts entity and tag menus inside the dialog scroll boundary", async () => {
    const user = userEvent.setup();
    renderModal({ mode: "create", entry: null });

    await user.click(screen.getByRole("textbox", { name: "From" }));
    expect(screen.getByText("Cafe").closest(".floating-menu-portal-host")).not.toBeNull();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("textbox", { name: "Tags" }));
    expect(screen.getByText("coffee").closest(".floating-menu-portal-host")).not.toBeNull();
  });

  it("shows manual group options when groups are available", async () => {
    const user = userEvent.setup();

    renderModal({
      mode: "create",
      entry: null,
      entities: [],
      groups: [
        {
          id: "group-1",
          name: "Manual Group",
          description: null,
          color: null,
          source: "manual",
          rule_summary: null,
          member_count: 0,
          first_occurred_at: null,
          last_occurred_at: null,
          position: 0,
          created_at: "2026-03-05T00:00:00Z",
          updated_at: "2026-03-05T00:00:00Z"
        },
        {
          id: "group-2",
          name: "Rule Group",
          description: null,
          color: null,
          source: "rule",
          rule_summary: "tags has_any grocery",
          member_count: 0,
          first_occurred_at: null,
          last_occurred_at: null,
          position: 1,
          created_at: "2026-03-05T00:00:00Z",
          updated_at: "2026-03-05T00:00:00Z"
        }
      ]
    });

    await user.click(screen.getByRole("textbox", { name: "Manual groups" }));
    await user.click(screen.getByRole("button", { name: "Manual Group" }));

    expect(screen.getByText("Manual Group")).toBeInTheDocument();
    expect(screen.queryByText("Rule Group · rule")).not.toBeInTheDocument();
  });

  it("swaps the from and to values before submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    renderModal({ onClose, onSubmit });

    await user.click(screen.getByRole("button", { name: "Swap from and to" }));

    expect(screen.getByLabelText("From")).toHaveValue("Cafe");
    expect(screen.getByLabelText("To")).toHaveValue("Checking");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          from_entity_id: "entity-2",
          from_entity: null,
          to_entity_id: null,
          to_entity: "Checking"
        })
      )
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps owner implicit and submits the current user id", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderModal({
      mode: "create",
      entry: null,
      entities: [],
      onSubmit
    });

    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "12.50");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          owner_user_id: "user-1",
          name: "Lunch",
          amount_minor: 1250
        })
      )
    );
  });

  it("submits when re-linking a preserved missing label to an existing entity with the same name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    renderModal({
      entry: {
        ...entryFixture,
        kind: "TRANSFER",
        name: "Transfer to Saving Account",
        to_entity_id: null,
        to_entity: "Saving Account",
        to_entity_missing: true
      },
      entities: [
        { id: "entity-2", name: "Cafe", category: "Food", is_account: false, from_count: 0, to_count: 1, account_count: 0, entry_count: 1 },
        {
          id: "entity-3",
          name: "Saving Account",
          category: "Account",
          is_account: true,
          from_count: 0,
          to_count: 1,
          account_count: 1,
          entry_count: 1
        }
      ],
      onClose,
      onSubmit
    });

    await user.click(screen.getAllByRole("button", { name: "Toggle options" })[1]);
    await user.click(screen.getByRole("button", { name: "Saving Account" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          to_entity_id: "entity-3",
          to_entity: null
        })
      )
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("notifies when tagging is disabled by settings", async () => {
    const user = userEvent.setup();

    renderModal();

    await user.click(screen.getByRole("button", { name: "Suggest tags with AI" }));

    expect(
      await screen.findByText("AI tag suggestion is disabled until you set Default tagging model in Settings.")
    ).toBeInTheDocument();
    expect(suggestEntryTags).not.toHaveBeenCalled();
  });

  it("blocks suggestion when the create draft has no meaningful context", async () => {
    const user = userEvent.setup();

    renderModal({
      mode: "create",
      entry: null,
      entities: [],
      entryTaggingModel: "openai/gpt-4.1-mini",
    });

    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Suggest tags with AI" }));

    expect(
      await screen.findByText("Add a name, amount, entity, notes, or tags before asking AI for tag suggestions.")
    ).toBeInTheDocument();
    expect(suggestEntryTags).not.toHaveBeenCalled();
  });

  it("replaces the current tags with the AI suggestion", async () => {
    const user = userEvent.setup();
    vi.mocked(suggestEntryTags).mockResolvedValue({
      suggested_tags: ["grocery"],
      suggested_category: null,
      suggested_lifecycle: null
    });

    renderModal({
      entry: {
        ...entryFixture,
        tags: [{ id: 1, name: "coffee", color: "#5f6caf", description: "Coffee purchases" }]
      },
      entryTaggingModel: "openai/gpt-4.1-mini"
    });

    expect(screen.getByText("coffee")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Suggest tags with AI" }));

    await waitFor(() => expect(suggestEntryTags).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("grocery")).toBeInTheDocument());
    expect(screen.queryByText("coffee")).not.toBeInTheDocument();
  });

  it("interrupts an in-flight suggestion without changing tags and ignores a late success", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<EntryTagSuggestionResponse>();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(suggestEntryTags).mockImplementation(async (payload) => {
      capturedSignal = payload.signal;
      return deferred.promise;
    });

    renderModal({
      entry: {
        ...entryFixture,
        tags: [{ id: 1, name: "coffee", color: "#5f6caf", description: "Coffee purchases" }]
      },
      entryTaggingModel: "openai/gpt-4.1-mini"
    });

    await user.click(screen.getByRole("button", { name: "Suggest tags with AI" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop AI tag suggestion" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Stop AI tag suggestion" }));
    deferred.resolve({ suggested_tags: ["grocery"], suggested_category: null, suggested_lifecycle: null });

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Suggest tags with AI" })).toBeInTheDocument());
    expect(screen.getByText("coffee")).toBeInTheDocument();
    expect(screen.queryByText("grocery")).not.toBeInTheDocument();
  });

  it("aborts an in-flight suggestion when the modal closes", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<EntryTagSuggestionResponse>();
    let capturedSignal: AbortSignal | undefined;
    const onClose = vi.fn();
    vi.mocked(suggestEntryTags).mockImplementation(async (payload) => {
      capturedSignal = payload.signal;
      return deferred.promise;
    });

    renderModal({
      entryTaggingModel: "openai/gpt-4.1-mini",
      onClose
    });

    await user.click(screen.getByRole("button", { name: "Suggest tags with AI" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop AI tag suggestion" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    expect(onClose).toHaveBeenCalledTimes(1);

    deferred.resolve({ suggested_tags: ["grocery"], suggested_category: null, suggested_lifecycle: null });
  });
});
