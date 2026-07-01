/**
 * CALLING SPEC:
 * - Purpose: render the `EntitiesPage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/EntitiesPage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `EntitiesPage`.
 * - Side effects: React rendering and user event wiring.
 */
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { EntitiesTableSection } from "../features/entities/EntitiesTableSection";
import { EntitiesTableToolbar } from "../features/entities/EntitiesTableToolbar";
import { useEntitiesPageModel } from "../features/entities/useEntitiesPageModel";
import { getApiErrorMessage } from "../lib/api/core";

export function EntitiesPage() {
  const model = useEntitiesPageModel();
  const entitiesError = model.queries.entitiesQuery.isError ? getApiErrorMessage(model.queries.entitiesQuery.error) : null;
  const createError = model.mutations.createEntityMutation.isError ? getApiErrorMessage(model.mutations.createEntityMutation.error) : null;
  const updateError = model.mutations.updateEntityMutation.isError ? getApiErrorMessage(model.mutations.updateEntityMutation.error) : null;
  const deleteError = model.mutations.deleteEntityMutation.isError ? getApiErrorMessage(model.mutations.deleteEntityMutation.error) : null;

  return (
    <div className="page">
      <WorkspaceSection contentClassName="workspace-table-body">
        <EntitiesTableToolbar
          search={model.search}
          categoryOptions={model.categoryFilterOptions}
          selectedCategories={model.selectedCategories}
          onSearchChange={model.setSearch}
          onCategoriesChange={model.setSelectedCategories}
          onToggleCreatePanel={() => model.setCreatePanelOpen((open) => !open)}
        />
        <div className="table-shell">
          <EntitiesTableSection
            createPanelOpen={model.createPanelOpen}
          onToggleCreatePanel={() => model.setCreatePanelOpen((open) => !open)}
          onCloseCreatePanel={model.closeCreatePanel}
          newEntityName={model.forms.newEntityName}
          onNewEntityNameChange={model.forms.setNewEntityName}
          newEntityCategory={model.forms.newEntityCategory}
          onNewEntityCategoryChange={model.forms.setNewEntityCategory}
          editingEntityId={model.forms.editingEntityId}
          editingEntityName={model.forms.editingEntityName}
          onEditingEntityNameChange={model.forms.setEditingEntityName}
          editingEntityCategory={model.forms.editingEntityCategory}
          onEditingEntityCategoryChange={model.forms.setEditingEntityCategory}
          onStartEditEntity={model.actions.startEditEntity}
          onCancelEditEntity={model.actions.cancelEditEntity}
          onSaveEntity={model.actions.saveEntity}
          onStartDeleteEntity={model.actions.startDeleteEntity}
          onCancelDeleteEntity={model.actions.cancelDeleteEntity}
          onConfirmDeleteEntity={model.actions.confirmDeleteEntity}
          onCreateEntitySubmit={model.actions.onCreateEntity}
          entities={model.filteredEntities}
          deletingEntity={model.deletingEntity}
          hasAnyEntities={model.hasAnyEntities}
          entityCategoryOptions={model.entityCategoryOptions}
          isLoading={model.queries.entitiesQuery.isLoading}
          isError={model.queries.entitiesQuery.isError}
          queryErrorMessage={entitiesError}
          createErrorMessage={createError}
          updateErrorMessage={updateError}
          deleteErrorMessage={deleteError}
          isCreating={model.mutations.createEntityMutation.isPending}
          isUpdating={model.mutations.updateEntityMutation.isPending}
          isDeleting={model.mutations.deleteEntityMutation.isPending}
        />
        </div>
      </WorkspaceSection>
    </div>
  );
}
