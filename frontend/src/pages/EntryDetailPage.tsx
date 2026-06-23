/**
 * CALLING SPEC:
 * - Purpose: render the `EntryDetailPage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/EntryDetailPage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `EntryDetailPage`.
 * - Side effects: React rendering and user event wiring.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { EntryEditorModal, type EntryEditorSubmitPayload } from "../components/EntryEditorModal";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAuth } from "../features/auth";
import {
  getEntry,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listGroups,
  listTags,
  listTaxonomyTerms,
  listUsers,
  updateEntry
} from "../lib/api";
import { ENTRY_CATEGORY_TAXONOMY_KEY, formatEntryLifecycle } from "../lib/catalogs";
import { formatMinor } from "../lib/format";
import { invalidateEntryReadModels } from "../lib/queryInvalidation";
import { queryKeys } from "../lib/queryKeys";

function kindLabel(kind: string) {
  if (kind === "INCOME") return "Income";
  if (kind === "TRANSFER") return "Transfer";
  return "Expense";
}

function kindSymbol(kind: string) {
  if (kind === "INCOME") return "+";
  if (kind === "TRANSFER") return "~";
  return "-";
}

export function EntryDetailPage() {
  const { entryId } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const entryQuery = useQuery({
    queryKey: queryKeys.entries.detail(entryId ?? ""),
    queryFn: () => getEntry(entryId!),
    enabled: Boolean(entryId)
  });

  const currenciesQuery = useQuery({ queryKey: queryKeys.properties.currencies, queryFn: listCurrencies });
  const entitiesQuery = useQuery({ queryKey: queryKeys.properties.entities, queryFn: listEntities });
  const usersQuery = useQuery({ queryKey: queryKeys.properties.users, queryFn: listUsers });
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.list,
    queryFn: listGroups,
    enabled: isEditorOpen
  });
  const tagsQuery = useQuery({ queryKey: queryKeys.properties.tags, queryFn: listTags });
  const categoryTermsQuery = useQuery({
    queryKey: queryKeys.properties.taxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY),
    queryFn: () => listTaxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY)
  });
  const runtimeSettingsQuery = useQuery({ queryKey: queryKeys.settings.runtime, queryFn: getRuntimeSettings });

  const currentUserId = auth.session?.user.id ?? usersQuery.data?.find((user) => user.is_current_user)?.id ?? "";

  const updateMutation = useMutation({
    mutationFn: (payload: EntryEditorSubmitPayload) => updateEntry(entryId!, payload),
    onSuccess: () => {
      if (!entryId) {
        return;
      }
      invalidateEntryReadModels(queryClient, entryId);
      setIsEditorOpen(false);
    }
  });

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
  const entrySummary = `${entry.occurred_at} | ${kindLabel(entry.kind)} ${kindSymbol(entry.kind)} | ${formatMinor(entry.amount_minor, entry.currency_code)}`;

  return (
    <div className="page stack-lg">
      <WorkspaceSection
        title={entry.name}
        description={entrySummary}
        actions={
          <div className="table-actions">
            <Button asChild variant="outline" size="sm">
              <Link to="/entries">Back to entries</Link>
            </Button>
            <Button type="button" size="sm" onClick={() => setIsEditorOpen(true)}>
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
          entry.groups.length > 0
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
          {entry.groups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {entry.groups.map((group) => (
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
        isOpen={isEditorOpen}
        mode="edit"
        entry={entry}
        currencies={currenciesQuery.data ?? []}
        entities={entitiesQuery.data ?? []}
        groups={groupsQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        categoryTerms={categoryTermsQuery.data ?? []}
        currentUserId={currentUserId}
        defaultCurrencyCode={runtimeSettingsQuery.data?.default_currency_code ?? "USD"}
        entryTaggingModel={runtimeSettingsQuery.data?.entry_tagging_model}
        isSaving={updateMutation.isPending}
        saveError={updateMutation.isError ? (updateMutation.error as Error).message : undefined}
        onClose={() => setIsEditorOpen(false)}
        onSubmit={(payload) => updateMutation.mutate(payload)}
      />
    </div>
  );
}
