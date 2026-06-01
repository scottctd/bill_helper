/**
 * CALLING SPEC:
 * - Purpose: provide the `usePropertiesSectionState` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/properties/usePropertiesSectionState.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `usePropertiesSectionState`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { useState } from "react";

import {
  SECTION_CREATE_PANEL_DEFAULTS,
  SECTION_CURRENCY_STATUS_FILTER_DEFAULT,
  SECTION_SEARCH_DEFAULTS,
  SECTION_TAG_TYPE_FILTER_DEFAULTS,
  type CurrencyStatusFilter,
  type PropertiesSectionId
} from "./types";

export function usePropertiesSectionState() {
  const [activeSection, setActiveSection] = useState<PropertiesSectionId>("tags");
  const [sectionSearch, setSectionSearch] = useState<Record<PropertiesSectionId, string>>({
    ...SECTION_SEARCH_DEFAULTS
  });
  const [selectedTagTypes, setSelectedTagTypes] = useState<string[]>([...SECTION_TAG_TYPE_FILTER_DEFAULTS]);
  const [currencyStatusFilter, setCurrencyStatusFilter] = useState<CurrencyStatusFilter>(
    SECTION_CURRENCY_STATUS_FILTER_DEFAULT
  );
  const [createPanelOpen, setCreatePanelOpen] = useState<Record<PropertiesSectionId, boolean>>({
    ...SECTION_CREATE_PANEL_DEFAULTS
  });

  function setSectionSearchValue(sectionId: PropertiesSectionId, value: string) {
    setSectionSearch((state) => ({ ...state, [sectionId]: value }));
  }

  function toggleCreatePanel(sectionId: PropertiesSectionId) {
    setCreatePanelOpen((state) => ({ ...state, [sectionId]: !state[sectionId] }));
  }

  function closeCreatePanel(sectionId: PropertiesSectionId) {
    setCreatePanelOpen((state) => ({ ...state, [sectionId]: false }));
  }

  return {
    activeSection,
    setActiveSection,
    sectionSearch,
    selectedTagTypes,
    setSelectedTagTypes,
    currencyStatusFilter,
    setCurrencyStatusFilter,
    createPanelOpen,
    actions: {
      setSectionSearchValue,
      toggleCreatePanel,
      closeCreatePanel
    }
  };
}
