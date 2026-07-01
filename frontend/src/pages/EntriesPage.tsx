/**
 * CALLING SPEC:
 * - Purpose: render the `EntriesPage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/EntriesPage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `EntriesPage`.
 * - Side effects: React rendering and user event wiring.
 */
import { EntryEditorModal } from "../components/EntryEditorModal";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { EntriesFilterToolbar } from "../features/entries/EntriesFilterToolbar";
import { EntriesTable } from "../features/entries/EntriesTable";
import { useEntriesPageModel } from "../features/entries/useEntriesPageModel";

export function EntriesPage() {
  const model = useEntriesPageModel();

  return (
    <div className="page">
      <WorkspaceSection contentClassName="workspace-table-body">
        <EntriesFilterToolbar
          filters={model.filters}
          tagOptions={model.queries.tagsQuery.data ?? []}
          currencyOptions={model.currencyFilterOptions}
          entityOptions={model.entityFilterOptions}
          categoryOptions={model.categoryFilterOptions}
          dateRangeError={model.dateRangeError}
          activeFilterCount={model.activeFilterCount}
          visibleEntryCount={model.filteredEntries.length}
          totalEntryCount={model.totalEntries}
          onFiltersChange={model.actions.updateFilters}
          onClearFilters={model.actions.clearFilters}
          onAddEntry={() => model.setEditorState({ mode: "create" })}
        />

        <EntriesTable model={model} />
      </WorkspaceSection>

      <EntryEditorModal
        isOpen={model.editorState !== null}
        mode={model.editorState?.mode ?? "create"}
        entry={model.editorState?.mode === "edit" ? model.queries.editingEntryQuery.data ?? null : null}
        currencies={model.queries.currenciesQuery.data ?? []}
        entities={model.queries.entitiesQuery.data ?? []}
        groups={model.queries.groupsQuery.data ?? []}
        tags={model.queries.tagsQuery.data ?? []}
        categoryTerms={model.queries.categoryTermsQuery.data ?? []}
        currentUserId={model.currentUserId}
        defaultCurrencyCode={(model.queries.runtimeSettingsQuery.data?.default_currency_code ?? "CAD").toUpperCase()}
        entryTaggingModel={model.queries.runtimeSettingsQuery.data?.entry_tagging_model}
        isSaving={model.mutations.createEntryMutation.isPending || model.mutations.updateEntryMutation.isPending}
        loadError={model.editorLoadError}
        saveError={model.editorSaveError}
        onClose={() => model.setEditorState(null)}
        onSubmit={model.actions.handleEditorSubmit}
      />
    </div>
  );
}
