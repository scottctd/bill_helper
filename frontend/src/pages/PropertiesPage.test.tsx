import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PropertiesPage } from "./PropertiesPage";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import {
  createTag,
  createTaxonomyTerm,
  deleteTag,
  deleteTaxonomyTerm,
  listCurrencies,
  listTags,
  listTaxonomies,
  listTaxonomyTerms,
  updateTag,
  updateTaxonomyTerm
} from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listUsers: vi.fn(),
    listTags: vi.fn(),
    listCurrencies: vi.fn(),
    listTaxonomies: vi.fn(),
    listTaxonomyTerms: vi.fn(),
    createTag: vi.fn(),
    deleteTag: vi.fn(),
    deleteTaxonomyTerm: vi.fn(),
    updateTag: vi.fn(),
    createTaxonomyTerm: vi.fn(),
    updateTaxonomyTerm: vi.fn()
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

function mockBasePropertiesApi() {
  vi.mocked(listTags).mockResolvedValue([{ id: 1, name: "groceries", color: "#22aa66", type: "Food", entry_count: 2 }]);
  vi.mocked(listCurrencies).mockResolvedValue([{ code: "CAD", name: "Canadian Dollar", entry_count: 3, is_placeholder: false }]);
  vi.mocked(listTaxonomies).mockResolvedValue([
    {
      id: "taxonomy-entry",
      key: "entry_category",
      applies_to: "entry",
      cardinality: "single",
      display_name: "Entry Categories"
    },
    {
      id: "taxonomy-entity",
      key: "entity_category",
      applies_to: "entity",
      cardinality: "single",
      display_name: "Entity Categories"
    },
    {
      id: "taxonomy-tag",
      key: "tag_type",
      applies_to: "tag",
      cardinality: "single",
      display_name: "Tag Types"
    }
  ]);
  vi.mocked(listTaxonomyTerms).mockImplementation(async (taxonomyKey: string) => {
    if (taxonomyKey === "entry_category") {
      return [
        {
          id: "term-entry-food",
          taxonomy_id: "taxonomy-entry",
          name: "food_drink",
          normalized_name: "food_drink",
          parent_term_id: null,
          description: "Food bought for home or prepared away from home.",
          usage_count: 0
        },
        {
          id: "term-entry-groceries",
          taxonomy_id: "taxonomy-entry",
          name: "groceries",
          normalized_name: "groceries",
          parent_term_id: "term-entry-food",
          description: "Food and household staples bought for home.",
          default_lifecycle: "day_to_day",
          usage_count: 2
        }
      ];
    }
    if (taxonomyKey === "entity_category") {
      return [{ id: "term-entity-1", taxonomy_id: "taxonomy-entity", name: "Food", normalized_name: "food", parent_term_id: null, usage_count: 1 }];
    }
    return [{ id: "term-tag-1", taxonomy_id: "taxonomy-tag", name: "Food", normalized_name: "food", parent_term_id: null, usage_count: 1 }];
  });
  vi.mocked(createTag).mockResolvedValue({ id: 2, name: "rent", color: null, type: "Housing", entry_count: 0 });
  vi.mocked(updateTag).mockResolvedValue({ id: 1, name: "groceries", color: "#22aa66", type: "Food", entry_count: 2 });
  vi.mocked(deleteTag).mockResolvedValue(undefined);
  vi.mocked(deleteTaxonomyTerm).mockResolvedValue(undefined);
  vi.mocked(createTaxonomyTerm).mockImplementation(async (_taxonomyKey, payload) => ({
    id: `term-${payload.name}`,
    taxonomy_id: "taxonomy",
    name: payload.name,
    normalized_name: payload.name.toLowerCase(),
    parent_term_id: null,
    usage_count: 0
  }));
  vi.mocked(updateTaxonomyTerm).mockImplementation(async (_taxonomyKey, termId, payload) => ({
    id: termId,
    taxonomy_id: "taxonomy",
    name: payload.name ?? "Updated",
    normalized_name: (payload.name ?? "Updated").toLowerCase(),
    parent_term_id: null,
    usage_count: 0
  }));
}

describe("PropertiesPage", () => {
  it("filters tags by selected type", async () => {
    mockBasePropertiesApi();
    vi.mocked(listTags).mockResolvedValue([
      { id: 1, name: "groceries", color: "#22aa66", type: "Food", entry_count: 2 },
      { id: 2, name: "flight", color: "#2266aa", type: "Travel", entry_count: 1 }
    ]);
    const user = userEvent.setup();
    renderWithQueryClient(<PropertiesPage />);

    await screen.findByRole("button", { name: "Tags" });

    expect(await screen.findByText("groceries")).toBeInTheDocument();
    expect(screen.getByText("flight")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tag type filter" }));
    await user.click(await screen.findByRole("button", { name: /Travel/i }));

    await waitFor(() => {
      expect(screen.queryByText("groceries")).not.toBeInTheDocument();
    });
    expect(screen.getByText("flight")).toBeInTheDocument();
  });

  it("creates tag taxonomy terms from the taxonomy section", async () => {
    mockBasePropertiesApi();
    renderWithQueryClient(<PropertiesPage />);

    await screen.findByRole("button", { name: "Tag Types" });
    await userEvent.click(screen.getByRole("button", { name: "Tag Types" }));
    await userEvent.click(screen.getByRole("button", { name: "Add term" }));

    const termNameInput = screen.getByPlaceholderText("e.g. food");
    await userEvent.type(termNameInput, "Household");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createTaxonomyTerm).toHaveBeenCalled();
    });
    expect(vi.mocked(createTaxonomyTerm).mock.calls[0]?.[0]).toBe("tag_type");
    expect(vi.mocked(createTaxonomyTerm).mock.calls[0]?.[1]).toEqual({ name: "Household" });
  });

  it("creates, edits, and deletes entry-category children with lifecycle defaults", async () => {
    mockBasePropertiesApi();
    renderWithQueryClient(<PropertiesPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Entry Categories" }));
    expect(await screen.findByText("groceries")).toBeInTheDocument();
    expect(screen.getByText("day-to-day")).toBeInTheDocument();
    expect(screen.getByText("Food bought for home or prepared away from home.")).toBeInTheDocument();
    expect(screen.getByText("Food and household staples bought for home.")).toBeInTheDocument();
    expect(screen.getByText("groceries").closest("tr")?.querySelector(".entry-category-swatch")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Add entry category" }));
    const createDialog = await screen.findByRole("dialog", { name: "Create Entry Category" });
    await userEvent.type(within(createDialog).getByLabelText("Name"), "restaurants");
    await userEvent.selectOptions(within(createDialog).getByLabelText("Parent"), "term-entry-food");
    await userEvent.type(within(createDialog).getByLabelText("Description"), "Meals prepared by restaurants.");
    await userEvent.selectOptions(within(createDialog).getByLabelText("Default lifecycle"), "day_to_day");
    await userEvent.click(within(createDialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createTaxonomyTerm).toHaveBeenCalledWith("entry_category", {
        name: "restaurants",
        description: "Meals prepared by restaurants.",
        parent_term_id: "term-entry-food",
        default_lifecycle: "day_to_day"
      });
    });

    const groceriesRow = screen.getByText("groceries").closest("tr");
    expect(groceriesRow).not.toBeNull();
    if (!groceriesRow) throw new Error("Expected groceries row");
    expect(within(groceriesRow).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    await userEvent.dblClick(groceriesRow);
    const editDialog = await screen.findByRole("dialog", { name: "Edit Entry Category" });
    await userEvent.clear(within(editDialog).getByLabelText("Name"));
    await userEvent.type(within(editDialog).getByLabelText("Name"), "market");
    await userEvent.clear(within(editDialog).getByLabelText("Description"));
    await userEvent.type(within(editDialog).getByLabelText("Description"), "Groceries and household staples.");
    await userEvent.selectOptions(within(editDialog).getByLabelText("Default lifecycle"), "fixed");
    await userEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateTaxonomyTerm).toHaveBeenCalledWith("entry_category", "term-entry-groceries", {
        name: "market",
        description: "Groceries and household staples.",
        default_lifecycle: "fixed"
      });
    });

    const parentRow = screen.getByText("food_drink").closest("tr");
    expect(parentRow).not.toBeNull();
    if (!parentRow) throw new Error("Expected food_drink row");
    await userEvent.dblClick(parentRow);
    const parentEditDialog = await screen.findByRole("dialog", { name: "Edit Entry Category" });
    expect(within(parentEditDialog).getByLabelText("Description")).toHaveValue(
      "Food bought for home or prepared away from home."
    );
    await userEvent.click(within(parentEditDialog).getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: "Delete entry category food_drink/groceries" }));
    const deleteDialog = await screen.findByRole("dialog", { name: "Delete groceries?" });
    await userEvent.click(within(deleteDialog).getByRole("button", { name: "Delete category" }));

    await waitFor(() => {
      expect(deleteTaxonomyTerm).toHaveBeenCalledWith("entry_category", "term-entry-groceries");
    });
  });

  it("deletes tags from the warning dialog", async () => {
    mockBasePropertiesApi();
    renderWithQueryClient(<PropertiesPage />);

    await screen.findByRole("button", { name: "Tags" });
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));

    await userEvent.click(screen.getByRole("button", { name: "Delete tag groceries" }));

    const deleteDialog = await screen.findByRole("dialog", { name: "Delete groceries?" });
    expect(within(deleteDialog).getByText(/removed from those entries/i)).toBeInTheDocument();

    await userEvent.click(within(deleteDialog).getByRole("button", { name: "Delete tag" }));

    await waitFor(() => {
      expect(vi.mocked(deleteTag).mock.calls[0]?.[0]).toBe(1);
    });
  });

  it("opens tag editing on row double-click and keeps delete isolated", async () => {
    mockBasePropertiesApi();
    renderWithQueryClient(<PropertiesPage />);

    await screen.findByRole("button", { name: "Tags" });
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    const tagRow = screen.getByText("groceries").closest("tr");
    expect(tagRow).not.toBeNull();
    if (!tagRow) {
      throw new Error("Expected tag row");
    }

    await userEvent.dblClick(tagRow);
    const editDialog = await screen.findByRole("dialog", { name: "Edit Tag" });
    expect(within(editDialog).getByLabelText("Name")).toHaveValue("groceries");

    await userEvent.click(within(editDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit Tag" })).not.toBeInTheDocument();
    });

    await userEvent.dblClick(screen.getByRole("button", { name: "Delete tag groceries" }));
    expect(await screen.findByRole("dialog", { name: "Delete groceries?" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit Tag" })).not.toBeInTheDocument();
  });

});
