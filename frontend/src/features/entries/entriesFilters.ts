/**
 * CALLING SPEC:
 * - Purpose: shared entry-list filter state, URL sync, and validation helpers.
 * - Inputs: URL search params or partial filter updates from the entries workspace.
 * - Outputs: normalized filter objects, validation results, and active-filter counts.
 * - Side effects: none.
 */

export type EntryListFilters = {
  startDate: string;
  endDate: string;
  kind: string;
  fromEntities: string[];
  toEntities: string[];
  tags: string[];
  currencies: string[];
  source: string;
  category: string;
  groupId: string;
};

export const EMPTY_ENTRY_LIST_FILTERS: EntryListFilters = {
  startDate: "",
  endDate: "",
  kind: "",
  fromEntities: [],
  toEntities: [],
  tags: [],
  currencies: [],
  source: "",
  category: "",
  groupId: ""
};

export function entryListFiltersFromSearchParams(searchParams: URLSearchParams): EntryListFilters {
  return {
    startDate: searchParams.get("start_date") ?? "",
    endDate: searchParams.get("end_date") ?? "",
    kind: "",
    fromEntities: searchParams.getAll("from_entity").filter(Boolean),
    toEntities: searchParams.getAll("to_entity").filter(Boolean),
    tags: [],
    currencies: [],
    source: "",
    category: searchParams.get("category") ?? "",
    groupId: searchParams.get("group_id") ?? ""
  };
}

export function entryListFiltersToSearchParams(filters: EntryListFilters, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);

  if (filters.startDate) {
    next.set("start_date", filters.startDate);
  } else {
    next.delete("start_date");
  }

  if (filters.endDate) {
    next.set("end_date", filters.endDate);
  } else {
    next.delete("end_date");
  }

  if (filters.groupId) {
    next.set("group_id", filters.groupId);
  } else {
    next.delete("group_id");
  }

  if (filters.category) {
    next.set("category", filters.category);
  } else {
    next.delete("category");
  }

  next.delete("from_entity");
  filters.fromEntities.forEach((entityName) => {
    if (entityName.trim()) {
      next.append("from_entity", entityName.trim());
    }
  });

  next.delete("to_entity");
  filters.toEntities.forEach((entityName) => {
    if (entityName.trim()) {
      next.append("to_entity", entityName.trim());
    }
  });

  return next;
}

export function entryListDateRangeError(filters: Pick<EntryListFilters, "startDate" | "endDate">): string | null {
  if (!filters.startDate || !filters.endDate) {
    return null;
  }
  if (filters.startDate > filters.endDate) {
    return "From date must be on or before To date.";
  }
  return null;
}

export function countActiveEntryListFilters(filters: EntryListFilters): number {
  let count = 0;
  if (filters.startDate) count += 1;
  if (filters.endDate) count += 1;
  if (filters.kind) count += 1;
  if (filters.fromEntities.length > 0) count += 1;
  if (filters.toEntities.length > 0) count += 1;
  if (filters.tags.length > 0) count += 1;
  if (filters.currencies.length > 0) count += 1;
  if (filters.source.trim()) count += 1;
  if (filters.category) count += 1;
  if (filters.groupId) count += 1;
  return count;
}

export function hasActiveEntryListFilters(filters: EntryListFilters): boolean {
  return countActiveEntryListFilters(filters) > 0;
}
