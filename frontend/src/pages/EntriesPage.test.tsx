import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { EntriesPage } from "./EntriesPage";
import { formatMinorCompact } from "../lib/format";
import { fallbackTagColor } from "../lib/tagColors";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { listOrEmpty } from "../lib/collections";
import type { Entry, RuntimeSettings, TaxonomyTerm } from "../lib/types";
import {
  createEntry,
  deleteEntry,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listEntries,
  listGroups,
  listTags,
  listTaxonomyTerms,
  listUsers,
  updateEntry
} from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listEntries: vi.fn(),
    listCurrencies: vi.fn(),
    listEntities: vi.fn(),
    listGroups: vi.fn(),
    listUsers: vi.fn(),
    listTags: vi.fn(),
    listTaxonomyTerms: vi.fn(),
    getRuntimeSettings: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn()
  };
});

const runtimeSettingsFixture: RuntimeSettings = {
  user_memory: null,
  default_currency_code: "CAD",
  dashboard_currency_code: "CAD",
  agent_model: "gpt-5",
  entry_tagging_model: null,
  available_agent_models: ["gpt-5"],
  agent_model_display_names: {},
  agent_max_steps: 20,
  agent_bulk_max_concurrent_threads: 4,
  agent_retry_max_attempts: 2,
  agent_retry_initial_wait_seconds: 1,
  agent_retry_max_wait_seconds: 8,
  agent_retry_backoff_multiplier: 2,
  agent_max_image_size_bytes: 5_000_000,
  agent_max_images_per_message: 4,
  agent_max_pdf_pages: 10,
  agent_base_url: null,
  agent_api_key_configured: false,
  vision_capable_agent_models: [],
  overrides: {
    user_memory: null,
    default_currency_code: null,
    dashboard_currency_code: null,
    agent_model: null,
    entry_tagging_model: null,
    available_agent_models: null,
    agent_model_display_names: null,
    agent_max_steps: null,
    agent_bulk_max_concurrent_threads: null,
    agent_retry_max_attempts: null,
    agent_retry_initial_wait_seconds: null,
    agent_retry_max_wait_seconds: null,
    agent_retry_backoff_multiplier: null,
    agent_max_image_size_bytes: null,
    agent_max_images_per_message: null,
    agent_max_pdf_pages: null,
    agent_base_url: null,
    agent_api_key_configured: false
  }
};

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
  lifecycle: "one_time",
  category: "food_drink/coffee_snacks",
  created_at: "2026-03-05T00:00:00Z",
  updated_at: "2026-03-05T00:00:00Z",
  groups: [],
  tags: [{ id: 1, name: "coffee", color: "#5f6caf", type: "Food" }]
};

const categoryTermsFixture: TaxonomyTerm[] = [
  {
    id: "term-food",
    taxonomy_id: "taxonomy-entry-category",
    name: "food_drink",
    normalized_name: "food_drink",
    parent_term_id: null,
    description: "Food and drink.",
    default_lifecycle: null,
    usage_count: 0
  },
  {
    id: "term-coffee",
    taxonomy_id: "taxonomy-entry-category",
    name: "coffee_snacks",
    normalized_name: "coffee_snacks",
    parent_term_id: "term-food",
    description: "Coffee and snacks.",
    default_lifecycle: "day_to_day",
    usage_count: 1
  },
  {
    id: "term-groceries",
    taxonomy_id: "taxonomy-entry-category",
    name: "groceries",
    normalized_name: "groceries",
    parent_term_id: "term-food",
    description: "Groceries.",
    default_lifecycle: "day_to_day",
    usage_count: 0
  }
];

afterEach(() => {
  vi.clearAllMocks();
});

function normalizeCssColor(color: string) {
  const element = document.createElement("div");
  element.style.color = color;
  return element.style.color;
}

function mockEntriesPageData(entry: Entry) {
  vi.mocked(listEntries).mockResolvedValue({
    items: [entry],
    total: 1,
    limit: 200,
    offset: 0
  });
  vi.mocked(listCurrencies).mockResolvedValue([{ code: "CAD", name: "Canadian Dollar", entry_count: 1, is_placeholder: false }]);
  vi.mocked(listEntities).mockResolvedValue([
    { id: "entity-2", name: "Cafe", category: "Food", is_account: false, from_count: 0, to_count: 1, account_count: 0, entry_count: 1, net_amount_mixed_currencies: false }
  ]);
  vi.mocked(listGroups).mockResolvedValue([]);
  vi.mocked(listUsers).mockResolvedValue([{ id: "user-1", name: "Alice", is_admin: false, is_current_user: true }]);
  vi.mocked(listTags).mockResolvedValue(listOrEmpty(entry.tags).map((tag) => ({ ...tag, entry_count: 0 })));
  vi.mocked(listTaxonomyTerms).mockResolvedValue(categoryTermsFixture);
  vi.mocked(getRuntimeSettings).mockResolvedValue(runtimeSettingsFixture);
  vi.mocked(createEntry).mockResolvedValue(entry);
  vi.mocked(updateEntry).mockResolvedValue(entry);
  vi.mocked(deleteEntry).mockResolvedValue(undefined);
}

describe("EntriesPage", () => {
  it("shows a missing-entity badge for preserved labels in the entries table", async () => {
    mockEntriesPageData(entryFixture);

    renderWithQueryClient(
      <MemoryRouter>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");
    expect(screen.getByText("Missing entity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete entry Coffee" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Kind" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Group" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lifecycle" })).toBeInTheDocument();
    expect(screen.getByText("coffee_snacks")).toBeInTheDocument();
    expect(screen.queryByText("food_drink/coffee_snacks")).not.toBeInTheDocument();
    expect(screen.getByText("one-time")).toBeInTheDocument();
    expect(screen.queryByText("group-1")).not.toBeInTheDocument();

    const amountCell = screen.getByText(formatMinorCompact(entryFixture.amount_minor)).closest(".entries-amount-cell");
    const amountMarker = amountCell?.querySelector(".entries-amount-marker");
    expect(amountMarker).not.toBeNull();
    expect(amountMarker).toHaveTextContent("-");
    expect(amountMarker).toHaveClass("entries-amount-marker-expense");
  });

  it("renders explicit and fallback tag colors in the entries table", async () => {
    const entryWithFallbackTag: Entry = {
      ...entryFixture,
      tags: [
        listOrEmpty(entryFixture.tags)[0]!,
        { id: 2, name: "travel", color: null, type: null }
      ]
    };
    mockEntriesPageData(entryWithFallbackTag);

    renderWithQueryClient(
      <MemoryRouter>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("travel");

    const coffeeChip = screen.getByText("coffee").closest(".entries-color-pill") as HTMLElement | null;
    const travelChip = screen.getByText("travel").closest(".entries-color-pill") as HTMLElement | null;
    const coffeeDot = coffeeChip?.querySelector(".entries-color-pill-dot");
    const travelDot = travelChip?.querySelector(".entries-color-pill-dot");
    const fallbackColor = fallbackTagColor("travel");

    expect(coffeeChip).not.toBeNull();
    expect(travelChip).not.toBeNull();
    expect(coffeeDot).not.toBeNull();
    expect(travelDot).not.toBeNull();

    expect(coffeeChip?.style.borderColor).toBe(normalizeCssColor("#5f6caf"));
    expect(coffeeDot?.getAttribute("style")).toContain(normalizeCssColor("#5f6caf"));
    expect(travelChip?.style.borderColor).toBe(normalizeCssColor(fallbackColor));
    expect(travelDot?.getAttribute("style")).toContain(normalizeCssColor(fallbackColor));
  });

  it("renders category and lifecycle as colored pills", async () => {
    mockEntriesPageData(entryFixture);

    renderWithQueryClient(
      <MemoryRouter>
        <EntriesPage />
      </MemoryRouter>
    );

    const categoryPill = (await screen.findByText("coffee_snacks")).closest(".entries-color-pill");
    const lifecyclePill = screen.getByText("one-time").closest(".entries-color-pill");

    expect(categoryPill).not.toBeNull();
    expect(lifecyclePill).not.toBeNull();
    expect(categoryPill?.querySelector(".entries-color-pill-dot")).not.toBeNull();
    expect(lifecyclePill?.querySelector(".entries-color-pill-dot")).not.toBeNull();
    expect(categoryPill?.getAttribute("style")).toContain("border-color");
    expect(categoryPill).toHaveAttribute("title", "food_drink/coffee_snacks");
    expect(lifecyclePill?.getAttribute("style")).toContain("border-color");
  });

  it("gives the tags column a constrained width so the name column keeps more space", async () => {
    mockEntriesPageData(entryFixture);

    renderWithQueryClient(
      <MemoryRouter>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");

    expect(screen.getByRole("table")).toHaveClass("entries-table", "table-fixed");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("entries-name-column");
    expect(screen.getByRole("columnheader", { name: "Tags" })).toHaveClass("entries-tags-column");
    expect(screen.getByRole("columnheader", { name: "Amount" })).toHaveClass("entries-amount-column");
    expect(screen.getByRole("columnheader", { name: "Category" })).toHaveClass("entries-category-column");
    expect(screen.getByRole("columnheader", { name: "Lifecycle" })).toHaveClass("entries-lifecycle-column");
    expect(screen.getByRole("columnheader", { name: "Actions" })).toHaveClass("entries-actions-column");
    expect(screen.queryByRole("columnheader", { name: "Kind" })).not.toBeInTheDocument();
    expect(screen.getByText("coffee")).toHaveClass("entries-color-pill-label");
  });

  it("passes date filters from the URL through to the entries query", async () => {
    mockEntriesPageData(entryFixture);

    renderWithQueryClient(
      <MemoryRouter initialEntries={["/entries?start_date=2026-01-01&end_date=2026-03-31"]}>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");
    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        start_date: "2026-01-01",
        end_date: "2026-03-31"
      })
    );
  });

  it("passes entity filters from the URL through to the entries query", async () => {
    mockEntriesPageData(entryFixture);

    renderWithQueryClient(
      <MemoryRouter initialEntries={["/entries?from_entity=Checking&to_entity=Cafe"]}>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");
    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        from_entity: ["Checking"],
        to_entity: ["Cafe"]
      })
    );
  });

  it("passes the selected filter group through to the entries query", async () => {
    mockEntriesPageData(entryFixture);
    vi.mocked(listGroups).mockResolvedValue([
      {
        id: "fg-1",
        name: "day-to-day",
        description: null,
        color: "#0f766e",
        source: "rule",
        position: 0,
        rule_summary: "kind is expense",
        member_count: 0,
        first_occurred_at: null,
        last_occurred_at: null,
        created_at: "2026-03-05T00:00:00Z",
        updated_at: "2026-03-05T00:00:00Z"
      }
    ]);

    renderWithQueryClient(
      <MemoryRouter initialEntries={["/entries?group_id=fg-1"]}>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");
    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: "fg-1"
      })
    );
  });

  it("replaces the filter-group toolbar control with a searchable category filter", async () => {
    const user = userEvent.setup();
    mockEntriesPageData(entryFixture);

    renderWithQueryClient(
      <MemoryRouter>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");
    expect(screen.queryByText("Filter group")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Category filter" }));
    await user.click(screen.getByRole("option", { name: "food_drink / groceries" }));

    await waitFor(() => {
      expect(listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "groceries"
        })
      );
    });
  });

  it("loads older entries when the user requests more rows", async () => {
    const olderEntry: Entry = {
      ...entryFixture,
      id: "entry-2",
      occurred_at: "2025-12-20",
      name: "Rent",
      amount_minor: 180000,
      tags: []
    };

    vi.mocked(listEntries).mockImplementation(async (params) => {
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 200;
      if (offset === 0) {
        return {
          items: [entryFixture],
          total: 2,
          limit,
          offset
        };
      }
      return {
        items: [olderEntry],
        total: 2,
        limit,
        offset
      };
    });
    vi.mocked(listCurrencies).mockResolvedValue([{ code: "CAD", name: "Canadian Dollar", entry_count: 2, is_placeholder: false }]);
    vi.mocked(listEntities).mockResolvedValue([
      { id: "entity-2", name: "Cafe", category: "Food", is_account: false, from_count: 0, to_count: 2, account_count: 0, entry_count: 2, net_amount_mixed_currencies: false }
    ]);
    vi.mocked(listGroups).mockResolvedValue([]);
    vi.mocked(listUsers).mockResolvedValue([{ id: "user-1", name: "Alice", is_admin: false, is_current_user: true }]);
    vi.mocked(listTags).mockResolvedValue(listOrEmpty(entryFixture.tags).map((tag) => ({ ...tag, entry_count: 0 })));
    vi.mocked(getRuntimeSettings).mockResolvedValue(runtimeSettingsFixture);
    vi.mocked(createEntry).mockResolvedValue(entryFixture);
    vi.mocked(updateEntry).mockResolvedValue(entryFixture);
    vi.mocked(deleteEntry).mockResolvedValue(undefined);

    renderWithQueryClient(
      <MemoryRouter>
        <EntriesPage />
      </MemoryRouter>
    );

    await screen.findByText("Coffee");
    expect(screen.queryByText("Rent")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Load more entries" }));

    await screen.findByText("Rent");
    expect(screen.getByText("Loaded all 2 entries.")).toBeInTheDocument();
    expect(listEntries).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 200 }));
    expect(listEntries).toHaveBeenCalledWith(expect.objectContaining({ offset: 1, limit: 200 }));
  });
});
