/**
 * CALLING SPEC:
 * - Purpose: shared helpers for workspace table multi-select and enum filters.
 * - Inputs: string option lists and selected filter values from workspace toolbars.
 * - Outputs: TagMultiSelect option shapes and normalized filter matching helpers.
 * - Side effects: none.
 */
import type { Tag } from "./types";

export const UNCATEGORIZED_FILTER_LABEL = "(none)";

export function stringOptionsAsTags(options: string[]): Tag[] {
  return options.map((name, index) => ({
    id: -1 - index,
    name,
    color: null,
    entry_count: 0
  }));
}

export function normalizeFilterValue(value: string | null | undefined, noneLabel = UNCATEGORIZED_FILTER_LABEL): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : noneLabel.toLowerCase();
}

export function matchesSelectedValues(
  value: string | null | undefined,
  selectedValues: string[],
  noneLabel = UNCATEGORIZED_FILTER_LABEL
): boolean {
  if (selectedValues.length === 0) {
    return true;
  }

  const selectedSet = new Set(selectedValues.map((entry) => normalizeFilterValue(entry, noneLabel)));
  return selectedSet.has(normalizeFilterValue(value, noneLabel));
}
