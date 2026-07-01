/**
 * CALLING SPEC:
 * - Purpose: manage the two-level entry-category taxonomy and leaf lifecycle defaults.
 * - Inputs: entry-category terms plus create, update, delete, search, and dialog state callbacks.
 * - Outputs: grouped parent/child category management UI.
 * - Side effects: React rendering and user event wiring only.
 */
import type { FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { DialogFooter } from "../../../components/ui/dialog";
import { ModalShell } from "../../../components/ui/modal-shell";
import { FormField } from "../../../components/ui/form-field";
import { Input } from "../../../components/ui/input";
import { NativeSelect } from "../../../components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { Textarea } from "../../../components/ui/textarea";
import { ENTRY_LIFECYCLE_VALUES, formatEntryLifecycle, includesFilter } from "../../../lib/catalogs";
import { entryCategoryColor } from "../../../lib/entryClassificationColors";
import type { TaxonomyTerm } from "../../../lib/types";

interface EntryCategoriesSectionProps {
  search: string;
  onSearchChange: (value: string) => void;
  createPanelOpen: boolean;
  onToggleCreatePanel: () => void;
  onCloseCreatePanel: () => void;
  newTermName: string;
  onNewTermNameChange: (value: string) => void;
  newTermDescription: string;
  onNewTermDescriptionChange: (value: string) => void;
  newParentId: string;
  onNewParentIdChange: (value: string) => void;
  newDefaultLifecycle: string;
  onNewDefaultLifecycleChange: (value: string) => void;
  editingTermId: string;
  editingTermName: string;
  onEditingTermNameChange: (value: string) => void;
  editingTermDescription: string;
  onEditingTermDescriptionChange: (value: string) => void;
  editingDefaultLifecycle: string;
  onEditingDefaultLifecycleChange: (value: string) => void;
  deletingTerm: TaxonomyTerm | null;
  onStartEditTerm: (term: TaxonomyTerm) => void;
  onCancelEditTerm: () => void;
  onSaveTerm: (termId: string) => void;
  onStartDeleteTerm: (term: TaxonomyTerm) => void;
  onCancelDeleteTerm: () => void;
  onConfirmDeleteTerm: () => void;
  onCreateTermSubmit: (event: FormEvent<HTMLFormElement>) => void;
  terms: TaxonomyTerm[] | undefined;
  isLoading: boolean;
  isError: boolean;
  queryErrorMessage: string | null;
  createErrorMessage: string | null;
  updateErrorMessage: string | null;
  deleteErrorMessage: string | null;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
}

function lifecycleLabel(value: string | null | undefined): string {
  if (!value) return "no default";
  return formatEntryLifecycle(value as (typeof ENTRY_LIFECYCLE_VALUES)[number]);
}

function LifecycleSelect({
  value,
  onChange,
  id
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">no default</option>
      {ENTRY_LIFECYCLE_VALUES.map((lifecycle) => (
        <option key={lifecycle} value={lifecycle}>
          {lifecycleLabel(lifecycle)}
        </option>
      ))}
    </NativeSelect>
  );
}

export function EntryCategoriesSection(props: EntryCategoriesSectionProps) {
  const terms = props.terms ?? [];
  const parents = terms
    .filter((term) => term.parent_term_id === null)
    .sort((left, right) => left.name.localeCompare(right.name));
  const childrenByParent = new Map<string, TaxonomyTerm[]>();
  for (const term of terms) {
    if (!term.parent_term_id) continue;
    const children = childrenByParent.get(term.parent_term_id) ?? [];
    children.push(term);
    childrenByParent.set(term.parent_term_id, children);
  }
  const visibleParents = parents.filter((parent) => {
    const children = childrenByParent.get(parent.id) ?? [];
    return (
      includesFilter(parent.name, props.search) ||
      includesFilter(parent.description, props.search) ||
      children.some(
        (child) =>
          includesFilter(child.name, props.search) ||
          includesFilter(child.description, props.search)
      )
    );
  });
  const editingTerm = terms.find((term) => term.id === props.editingTermId) ?? null;
  const editingIsLeaf =
    editingTerm !== null &&
    (editingTerm.parent_term_id !== null || (childrenByParent.get(editingTerm.id) ?? []).length === 0);

  return (
    <div className="table-shell">
      <div className="table-shell-header">
        <div>
          <h3 className="table-shell-title">Entry Categories</h3>
          <p className="table-shell-subtitle">
            A two-level expense partition. Leaf defaults prefill lifecycle and remain overridable per entry.
          </p>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="table-toolbar-filters">
          <label className="field min-w-[220px] grow">
            <span>Search</span>
            <Input
              placeholder="Filter entry categories"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
            />
          </label>
        </div>
        <div className="table-toolbar-action">
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Add entry category"
            onClick={props.onToggleCreatePanel}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {props.isLoading ? <p>Loading entry categories...</p> : null}
      {props.isError ? <p className="error">{props.queryErrorMessage}</p> : null}

      {props.terms ? (
        visibleParents.length > 0 ? (
          <Table className="entry-categories-table">
            <TableHeader>
              <TableRow>
                <TableHead className="entry-category-name-column">Category</TableHead>
                <TableHead className="entry-category-description-column">Description</TableHead>
                <TableHead className="entry-category-lifecycle-column">Default lifecycle</TableHead>
                <TableHead className="entry-category-usage-column">Usage</TableHead>
                <TableHead className="entry-category-actions-column">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleParents.flatMap((parent) => {
                const allChildren = (childrenByParent.get(parent.id) ?? []).sort((left, right) =>
                  left.name.localeCompare(right.name)
                );
                const visibleChildren = props.search
                  ? allChildren.filter(
                      (child) =>
                        includesFilter(parent.name, props.search) ||
                        includesFilter(parent.description, props.search) ||
                        includesFilter(child.name, props.search) ||
                        includesFilter(child.description, props.search)
                    )
                  : allChildren;
                const parentIsLeaf = allChildren.length === 0;
                const rows = [
                  <TableRow
                    key={parent.id}
                    className="entry-category-row"
                    onDoubleClick={() => props.onStartEditTerm(parent)}
                  >
                    <TableCell className="entry-category-name-column">
                      <span className="entry-category-name">
                        <span
                          className="entry-category-swatch"
                          style={{ backgroundColor: entryCategoryColor(parent.name) }}
                          aria-hidden
                        />
                        <span className="font-medium">{parent.name}</span>
                      </span>
                      <span className="entry-category-meta">
                        {parentIsLeaf ? "leaf category" : `${allChildren.length} sub-categories`}
                      </span>
                    </TableCell>
                    <TableCell className="entry-category-description-column">
                      <span className="entry-category-description">{parent.description || "-"}</span>
                    </TableCell>
                    <TableCell className="entry-category-lifecycle-column">{parentIsLeaf ? lifecycleLabel(parent.default_lifecycle) : "-"}</TableCell>
                    <TableCell className="entry-category-usage-column">{parent.usage_count}</TableCell>
                    <TableCell className="entry-category-actions-column">
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete entry category ${parent.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onStartDeleteTerm(parent);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ];
                for (const child of visibleChildren) {
                  rows.push(
                    <TableRow
                      key={child.id}
                      className="entry-category-row"
                      onDoubleClick={() => props.onStartEditTerm(child)}
                    >
                      <TableCell className="entry-category-name-column">
                        <span className="entry-category-name entry-category-child-name">
                          <span
                            className="entry-category-swatch"
                            style={{ backgroundColor: entryCategoryColor(`${parent.name}/${child.name}`) }}
                            aria-hidden
                          />
                          <span>{child.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="entry-category-description-column">
                        <span className="entry-category-description">{child.description || "-"}</span>
                      </TableCell>
                      <TableCell className="entry-category-lifecycle-column">{lifecycleLabel(child.default_lifecycle)}</TableCell>
                      <TableCell className="entry-category-usage-column">{child.usage_count}</TableCell>
                      <TableCell className="entry-category-actions-column">
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Delete entry category ${parent.name}/${child.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onStartDeleteTerm(child);
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }
                return rows;
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="muted">{terms.length > 0 ? "No categories match the current search." : "No entry categories yet."}</p>
        )
      ) : null}

      <ModalShell
        open={props.createPanelOpen}
        onOpenChange={(open) => {
          if (!open) props.onCloseCreatePanel();
        }}
        size="sm"
        title="Create Entry Category"
        description="Create a top-level category or place a sub-category under an existing parent."
      >
          <form className="grid gap-4" onSubmit={props.onCreateTermSubmit}>
            <FormField label="Name">
              <Input
                placeholder="e.g. groceries"
                value={props.newTermName}
                onChange={(event) => props.onNewTermNameChange(event.target.value)}
              />
            </FormField>
            <FormField label="Parent">
              <NativeSelect value={props.newParentId} onChange={(event) => props.onNewParentIdChange(event.target.value)}>
                <option value="">Top-level category</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Description">
              <Textarea
                aria-label="Description"
                placeholder="Explain what belongs in this category."
                value={props.newTermDescription}
                onChange={(event) => props.onNewTermDescriptionChange(event.target.value)}
              />
            </FormField>
            {props.newParentId ? (
              <FormField label="Default lifecycle">
                <LifecycleSelect
                  value={props.newDefaultLifecycle}
                  onChange={props.onNewDefaultLifecycleChange}
                />
              </FormField>
            ) : null}
            {props.createErrorMessage ? <p className="error">{props.createErrorMessage}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onCloseCreatePanel}>
                Cancel
              </Button>
              <Button type="submit" disabled={props.isCreating}>
                {props.isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
      </ModalShell>

      <ModalShell
        open={Boolean(editingTerm)}
        onOpenChange={(open) => {
          if (!open) props.onCancelEditTerm();
        }}
        size="sm"
        title="Edit Entry Category"
        description="Rename this category and update its lifecycle default when it is selectable."
      >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (editingTerm) props.onSaveTerm(editingTerm.id);
            }}
          >
            <FormField label="Name">
              <Input
                value={props.editingTermName}
                onChange={(event) => props.onEditingTermNameChange(event.target.value)}
              />
            </FormField>
            <FormField label="Description">
              <Textarea
                aria-label="Description"
                placeholder="Explain what belongs in this category."
                value={props.editingTermDescription}
                onChange={(event) => props.onEditingTermDescriptionChange(event.target.value)}
              />
            </FormField>
            {editingIsLeaf ? (
              <FormField label="Default lifecycle">
                <LifecycleSelect
                  value={props.editingDefaultLifecycle}
                  onChange={props.onEditingDefaultLifecycleChange}
                />
              </FormField>
            ) : null}
            {props.updateErrorMessage ? <p className="error">{props.updateErrorMessage}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onCancelEditTerm}>
                Cancel
              </Button>
              <Button type="submit" disabled={props.isUpdating}>
                {props.isUpdating ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
      </ModalShell>

      <ModalShell
        open={Boolean(props.deletingTerm)}
        onOpenChange={(open) => {
          if (!open) props.onCancelDeleteTerm();
        }}
        size="sm"
        title={`Delete ${props.deletingTerm?.name}?`}
        description="Entries using this category will become uncategorized. Parent categories must have no children."
        footer={
          <>
            <Button type="button" variant="outline" onClick={props.onCancelDeleteTerm}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={props.isDeleting} onClick={props.onConfirmDeleteTerm}>
              {props.isDeleting ? "Deleting..." : "Delete category"}
            </Button>
          </>
        }
      >
          {props.deleteErrorMessage ? <p className="error">{props.deleteErrorMessage}</p> : null}
      </ModalShell>
    </div>
  );
}
