/**
 * CALLING SPEC:
 * - Purpose: provide the `catalogs` frontend module.
 * - Inputs: callers that import `frontend/src/lib/catalogs.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `catalogs`.
 * - Side effects: module-local frontend behavior only.
 */
import type { EntryLifecycle, TaxonomyTerm } from "./types";

export const ENTITY_CATEGORY_TAXONOMY_KEY = "entity_category";
export const TAG_TYPE_TAXONOMY_KEY = "tag_type";
export const ENTRY_CATEGORY_TAXONOMY_KEY = "entry_category";
export const ENTRY_LIFECYCLE_VALUES: readonly EntryLifecycle[] = ["fixed", "day_to_day", "one_time"];

export function formatEntryLifecycle(value: EntryLifecycle): string {
  if (value === "day_to_day") return "day-to-day";
  if (value === "one_time") return "one-time";
  return "fixed";
}

export interface CategoryOption {
  /** Term name sent to the API as the `category` leaf. */
  leafName: string;
  /** Display path, e.g. "housing/rent" or "software_tools/software_subscriptions". */
  path: string;
  /** Top-level parent name, used to group options. Equal to leafName for parent-direct terms. */
  parentName: string;
  /** Suggested lifecycle for new entries in this category (overridable per entry). */
  defaultLifecycle: EntryLifecycle | null;
  /** True when the term is a top-level parent selected directly (no children). */
  isParentDirect: boolean;
}

export interface CategoryFilterOption {
  value: string;
  label: string;
  path: string | null;
}

export function buildCategoryOptions(terms: TaxonomyTerm[] | undefined): CategoryOption[] {
  const list = terms ?? [];
  const parents = list.filter((term) => term.parent_term_id === null);
  const childrenByParentId = new Map<string, TaxonomyTerm[]>();
  for (const term of list) {
    const parentId = term.parent_term_id;
    if (parentId == null) continue;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(term);
    childrenByParentId.set(parentId, siblings);
  }

  const asLifecycle = (value: string | null | undefined): EntryLifecycle | null =>
    value && (ENTRY_LIFECYCLE_VALUES as readonly string[]).includes(value)
      ? (value as EntryLifecycle)
      : null;

  const options: CategoryOption[] = [];
  for (const parent of parents) {
    const children = (childrenByParentId.get(parent.id) ?? []).slice().sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (children.length === 0) {
      options.push({
        leafName: parent.name,
        path: parent.name,
        parentName: parent.name,
        defaultLifecycle: asLifecycle(parent.default_lifecycle),
        isParentDirect: true,
      });
      continue;
    }
    for (const child of children) {
      options.push({
        leafName: child.name,
        path: `${parent.name}/${child.name}`,
        parentName: parent.name,
        defaultLifecycle: asLifecycle(child.default_lifecycle),
        isParentDirect: false,
      });
    }
  }
  return options.sort((left, right) => left.path.localeCompare(right.path));
}

export function buildCategoryFilterOptions(terms: TaxonomyTerm[] | undefined): CategoryFilterOption[] {
  const list = terms ?? [];
  const parentsById = new Map(
    list
      .filter((term) => term.parent_term_id === null)
      .map((term) => [term.id, term] as const)
  );
  const categoryOptions = list.map((term) => {
    const parent = term.parent_term_id ? parentsById.get(term.parent_term_id) : null;
    const path = parent ? `${parent.name}/${term.name}` : term.name;
    return {
      value: term.name,
      label: path.replace("/", " / "),
      path
    };
  });
  return [
    { value: "uncategorized", label: "uncategorized", path: null },
    ...categoryOptions.sort((left, right) => left.path.localeCompare(right.path))
  ];
}

/** Extract the leaf term name from a stored category path ("housing/rent" -> "rent"). */
export function categoryPathLeaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const segments = path.split("/");
  return segments[segments.length - 1] ?? null;
}

export function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

export function includesFilter(value: string | null | undefined, query: string) {
  const normalized = normalizeFilterValue(query);
  if (!normalized) {
    return true;
  }
  return (value ?? "").toLowerCase().includes(normalized);
}

export function uniqueOptionValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueValues.push(trimmed);
  }
  return uniqueValues.sort((left, right) => left.localeCompare(right));
}

export function taxonomyTermNames(terms: TaxonomyTerm[] | undefined) {
  return (terms ?? []).map((term) => term.name);
}
