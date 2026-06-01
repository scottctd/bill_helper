/**
 * CALLING SPEC:
 * - Purpose: provide the `usePropertiesFilteredData` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/properties/usePropertiesFilteredData.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `usePropertiesFilteredData`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { useMemo } from "react";

import type { Currency, Tag, TaxonomyTerm } from "../../lib/types";
import { includesFilter } from "../../lib/catalogs";
import { matchesSelectedValues } from "../../lib/workspaceFilters";
import type { CurrencyStatusFilter, PropertiesSectionId } from "./types";

interface PropertiesFilteredDataArgs {
  sectionSearch: Record<PropertiesSectionId, string>;
  selectedTagTypes: string[];
  currencyStatusFilter: CurrencyStatusFilter;
  tags: Tag[] | undefined;
  currencies: Currency[] | undefined;
  entityCategoryTerms: TaxonomyTerm[] | undefined;
  tagTypeTerms: TaxonomyTerm[] | undefined;
}

export function usePropertiesFilteredData(args: PropertiesFilteredDataArgs) {
  const {
    sectionSearch,
    selectedTagTypes,
    currencyStatusFilter,
    tags,
    currencies,
    entityCategoryTerms,
    tagTypeTerms
  } = args;

  const filteredTags = useMemo(() => {
    return (tags ?? []).filter((tag) => {
      const matchesSearch =
        includesFilter(tag.name, sectionSearch.tags) ||
        includesFilter(tag.type, sectionSearch.tags) ||
        includesFilter(tag.color, sectionSearch.tags) ||
        includesFilter(tag.description, sectionSearch.tags);
      if (!matchesSearch) {
        return false;
      }
      return matchesSelectedValues(tag.type, selectedTagTypes);
    });
  }, [sectionSearch.tags, selectedTagTypes, tags]);

  const filteredCurrencies = useMemo(() => {
    return (currencies ?? []).filter((currency) => {
      const matchesSearch =
        includesFilter(currency.code, sectionSearch.currencies) || includesFilter(currency.name, sectionSearch.currencies);
      if (!matchesSearch) {
        return false;
      }
      if (currencyStatusFilter === "built-in") {
        return !currency.is_placeholder;
      }
      if (currencyStatusFilter === "placeholder") {
        return currency.is_placeholder;
      }
      return true;
    });
  }, [currencies, currencyStatusFilter, sectionSearch.currencies]);

  const filteredEntityCategoryTerms = useMemo(() => {
    return (entityCategoryTerms ?? []).filter((term) => includesFilter(term.name, sectionSearch.entityCategories));
  }, [entityCategoryTerms, sectionSearch.entityCategories]);

  const filteredTagTypeTerms = useMemo(() => {
    return (tagTypeTerms ?? []).filter((term) => includesFilter(term.name, sectionSearch.tagCategories));
  }, [sectionSearch.tagCategories, tagTypeTerms]);

  return {
    tags: filteredTags,
    currencies: filteredCurrencies,
    entityCategoryTerms: filteredEntityCategoryTerms,
    tagTypeTerms: filteredTagTypeTerms
  };
}
