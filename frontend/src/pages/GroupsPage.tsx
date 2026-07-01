/**
 * CALLING SPEC:
 * - Purpose: render the `GroupsPage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/GroupsPage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `GroupsPage`.
 * - Side effects: React rendering and user event wiring.
 */
import { EntryEditorModal } from "../components/EntryEditorModal";
import { GroupDetailModal } from "../components/GroupDetailModal";
import { GroupEditorModal } from "../components/GroupEditorModal";
import { GroupMemberEditorModal } from "../components/GroupMemberEditorModal";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { GroupsBrowserTable } from "../features/groups/GroupsBrowserTable";
import { GroupsTableToolbar } from "../features/groups/GroupsTableToolbar";
import { useGroupsPageModel } from "../features/groups/useGroupsPageModel";
import { getApiErrorMessage } from "../lib/api/core";

export function GroupsPage() {
  const model = useGroupsPageModel();
  const { groupsQuery, groupDetailQuery, editingEntryQuery, currenciesQuery, runtimeSettingsQuery, entitiesQuery, tagsQuery, categoryTermsQuery } =
    model.queries;
  const {
    createGroupMutation,
    renameGroupMutation,
    deleteGroupMutation,
    addGroupMemberMutation,
    deleteGroupMemberMutation,
    updateEntryMutation
  } = model.mutations;

  const selectedGroupError = groupDetailQuery.isError ? getApiErrorMessage(groupDetailQuery.error) : null;
  const createGroupError = createGroupMutation.isError ? getApiErrorMessage(createGroupMutation.error) : null;
  const renameGroupError = renameGroupMutation.isError ? getApiErrorMessage(renameGroupMutation.error) : null;
  const addMemberError = addGroupMemberMutation.isError ? getApiErrorMessage(addGroupMemberMutation.error) : null;
  const deleteGroupError = deleteGroupMutation.isError ? getApiErrorMessage(deleteGroupMutation.error) : null;
  const deleteMemberError = deleteGroupMemberMutation.isError ? getApiErrorMessage(deleteGroupMemberMutation.error) : null;
  const entryEditorLoadError = editingEntryQuery.isError ? getApiErrorMessage(editingEntryQuery.error) : null;
  const entryEditorSaveError = updateEntryMutation.isError ? getApiErrorMessage(updateEntryMutation.error) : null;

  return (
    <div className="page">
      <WorkspaceSection className="groups-browser-card" contentClassName="workspace-table-body">
        <GroupsTableToolbar
          search={model.groupSearch}
          groupSourceOptions={model.groupSourceFilterOptions}
          selectedGroupSources={model.selectedGroupSources}
          onSearchChange={model.setGroupSearch}
          onGroupSourcesChange={model.setSelectedGroupSources}
          onAddGroup={() => model.setIsCreateGroupOpen(true)}
        />

        <GroupsBrowserTable model={model} />
      </WorkspaceSection>

      <GroupDetailModal
        isOpen={model.isDetailOpen}
        groupSummary={model.selectedGroupSummary}
        groupDetail={groupDetailQuery.data ?? null}
        isLoading={groupDetailQuery.isLoading}
        loadError={selectedGroupError}
        deleteGroupError={deleteGroupError}
        deleteMemberError={deleteMemberError}
        isDeletingGroup={deleteGroupMutation.isPending}
        isDeletingMember={deleteGroupMemberMutation.isPending}
        onClose={() => model.setIsDetailOpen(false)}
        onRename={() => model.setIsRenameGroupOpen(true)}
        onDelete={() => {
          if (model.selectedGroupSummary) {
            deleteGroupMutation.mutate(model.selectedGroupSummary.id);
          }
        }}
        onAddMember={() => model.setIsAddMemberOpen(true)}
        onOpenEntry={(entryId) => model.setEditingEntryId(entryId)}
        onRemoveMember={(membershipId) => deleteGroupMemberMutation.mutate(membershipId)}
      />

      <GroupEditorModal
        isOpen={model.isCreateGroupOpen}
        mode="create"
        isSaving={createGroupMutation.isPending}
        saveError={createGroupError}
        onClose={() => model.setIsCreateGroupOpen(false)}
        onSubmit={(payload) => createGroupMutation.mutate(payload)}
      />

      <GroupEditorModal
        isOpen={model.isRenameGroupOpen}
        mode="rename"
        initialName={model.selectedGroupSummary?.name ?? ""}
        initialGroupSource={model.selectedGroupSummary?.source ?? "manual"}
        isSaving={renameGroupMutation.isPending}
        saveError={renameGroupError}
        onClose={() => model.setIsRenameGroupOpen(false)}
        onSubmit={(payload) => renameGroupMutation.mutate({ name: payload.name })}
      />

      {model.selectedGroupSummary ? (
        <GroupMemberEditorModal
          isOpen={model.isAddMemberOpen}
          groupName={model.selectedGroupSummary.name}
          groupSource={model.selectedGroupSummary.source}
          entryOptions={model.entryOptions}
          isSaving={addGroupMemberMutation.isPending}
          saveError={addMemberError}
          onClose={() => model.setIsAddMemberOpen(false)}
          onSubmit={(payload) => addGroupMemberMutation.mutate(payload)}
        />
      ) : null}

      <EntryEditorModal
        isOpen={Boolean(model.editingEntryId)}
        mode="edit"
        entry={editingEntryQuery.data ?? null}
        currencies={currenciesQuery.data ?? []}
        entities={entitiesQuery.data ?? []}
        groups={groupsQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        categoryTerms={categoryTermsQuery.data ?? []}
        currentUserId={model.currentUserId}
        defaultCurrencyCode={(runtimeSettingsQuery.data?.default_currency_code ?? "CAD").toUpperCase()}
        entryTaggingModel={runtimeSettingsQuery.data?.entry_tagging_model}
        isSaving={updateEntryMutation.isPending}
        loadError={entryEditorLoadError}
        saveError={entryEditorSaveError}
        onClose={() => model.setEditingEntryId("")}
        onSubmit={model.actions.handleEntryEditorSubmit}
      />
    </div>
  );
}
