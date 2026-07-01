/**
 * CALLING SPEC:
 * - Purpose: render the `EntryDetailPage` React UI module.
 * - Inputs: route entry id from URL params.
 * - Outputs: entry detail layout and editor modal shell.
 * - Side effects: React rendering and user event wiring.
 */
import { Link, useParams } from "react-router-dom";

import { EntryEditorModal } from "../components/EntryEditorModal";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useEntryDetailPageModel } from "../features/entries/useEntryDetailPageModel";
import { listOrEmpty } from "../lib/collections";
import { formatEntryLifecycle } from "../lib/catalogs";
import { getApiErrorMessage } from "../lib/api/core";

export function EntryDetailPage() {
  const { entryId } = useParams();
  const model = useEntryDetailPageModel(entryId);
  const { entryQuery, currenciesQuery, entitiesQuery, groupsQuery, tagsQuery, categoryTermsQuery, runtimeSettingsQuery } =
    model.queries;
  const { updateMutation } = model.mutations;

  if (!entryId) {
    return <p>Missing entry id.</p>;
  }

  if (entryQuery.isLoading) {
    return <p>Loading entry...</p>;
  }

  if (entryQuery.isError || !entryQuery.data) {
    return <p className="error">Unable to load entry.</p>;
  }

  const entry = entryQuery.data;

  return (
    <div className="page stack-lg">
      <WorkspaceSection
        title={entry.name}
        description={model.entrySummary}
        actions={
          <div className="table-actions">
            <Button asChild variant="outline" size="sm">
              <Link to="/entries">Back to entries</Link>
            </Button>
            <Button type="button" size="sm" onClick={() => model.setIsEditorOpen(true)}>
              Edit in popup
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 text-sm">
          <div>
            <strong>From:</strong> {entry.from_entity || "(unspecified)"}
            {entry.from_entity_missing ? (
              <span className="ml-2">
                <Badge variant="outline">Missing entity</Badge>
              </span>
            ) : null}
          </div>
          <div>
            <strong>To:</strong> {entry.to_entity || "(unspecified)"}
            {entry.to_entity_missing ? (
              <span className="ml-2">
                <Badge variant="outline">Missing entity</Badge>
              </span>
            ) : null}
          </div>
          <div>
            <strong>Owner:</strong> {entry.owner ?? entry.owner_user_id}
          </div>
          <div>
            <strong>Category:</strong> {entry.category ?? "Uncategorized"}
          </div>
          <div>
            <strong>Lifecycle:</strong> {entry.lifecycle ? formatEntryLifecycle(entry.lifecycle) : "none"}
          </div>
        </div>
      </WorkspaceSection>

      <WorkspaceSection
        title="Groups"
        description={
          listOrEmpty(entry.groups).length > 0
            ? "Manual memberships are editable in the entry editor. Rule groups are computed automatically."
            : "This entry is not in any group yet."
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/groups">Open groups workspace</Link>
          </Button>
        }
      >
        <div className="grid gap-3 text-sm">
          {listOrEmpty(entry.groups).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {listOrEmpty(entry.groups).map((group) => (
                <Badge key={group.id} variant="outline">
                  {group.name} · {group.source}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="muted">Add this entry to a manual group from the groups workspace or entry editor.</p>
          )}
        </div>
      </WorkspaceSection>

      <EntryEditorModal
        isOpen={model.isEditorOpen}
        mode="edit"
        entry={entry}
        currencies={currenciesQuery.data ?? []}
        entities={entitiesQuery.data ?? []}
        groups={groupsQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        categoryTerms={categoryTermsQuery.data ?? []}
        currentUserId={model.currentUserId}
        defaultCurrencyCode={runtimeSettingsQuery.data?.default_currency_code ?? "USD"}
        entryTaggingModel={runtimeSettingsQuery.data?.entry_tagging_model}
        isSaving={updateMutation.isPending}
        saveError={updateMutation.isError ? getApiErrorMessage(updateMutation.error) : undefined}
        onClose={() => model.setIsEditorOpen(false)}
        onSubmit={(payload) => updateMutation.mutate(payload)}
      />
    </div>
  );
}
