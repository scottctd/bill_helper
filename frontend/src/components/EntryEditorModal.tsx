/**
 * CALLING SPEC:
 * - Purpose: render the `EntryEditorModal` React UI module.
 * - Inputs: callers that import `frontend/src/components/EntryEditorModal.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `EntryEditorModal`.
 * - Side effects: React rendering and user event wiring.
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Loader2, Sparkles, Square } from "lucide-react";

import { useEntryTagSuggestion } from "../hooks/useEntryTagSuggestion";
import type {
  Currency,
  Entity,
  Entry,
  EntryKind,
  EntryLifecycle,
  EntryTagSuggestionRequest,
  GroupMemberRole,
  GroupSummary,
  Tag,
  TaxonomyTerm,
} from "../lib/types";
import { buildCategoryOptions } from "../lib/catalogs";
import {
  entryCategoryColor,
  formatEntryCategoryLabel
} from "../lib/entryClassificationColors";
import { cn } from "../lib/utils";
import { CreatableSingleSelect } from "./CreatableSingleSelect";
import {
  KIND_OPTIONS,
  LIFECYCLE_OPTIONS,
  SPLIT_ROLE_OPTIONS,
  areFormStatesEqual,
  buildCreateForm,
  buildEditForm,
  nextSelectedEntityId,
  resolveEntityInput,
  uniqueNormalizedEntityNames,
  type EntryEditorFormState,
  type EntryEditorSubmitPayload
} from "./entryEditorModel";
import { MarkdownBlockEditor } from "./MarkdownBlockEditor";
import { SingleSelect } from "./SingleSelect";
import { TagMultiSelect } from "./TagMultiSelect";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";

export type { EntryEditorSubmitPayload } from "./entryEditorModel";

interface EntryEditorModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  entry: Entry | null;
  currencies: Currency[];
  entities: Entity[];
  groups: GroupSummary[];
  tags: Tag[];
  categoryTerms: TaxonomyTerm[];
  currentUserId: string;
  defaultCurrencyCode: string;
  entryTaggingModel?: string | null;
  isSaving: boolean;
  loadError?: string | null;
  saveError?: string | null;
  onClose: () => void;
  onSubmit: (payload: EntryEditorSubmitPayload) => void;
}

export function EntryEditorModal({
  isOpen,
  mode,
  entry,
  currencies,
  entities,
  groups,
  tags,
  categoryTerms,
  currentUserId,
  defaultCurrencyCode,
  entryTaggingModel,
  isSaving,
  loadError,
  saveError,
  onClose,
  onSubmit
}: EntryEditorModalProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [formState, setFormState] = useState<EntryEditorFormState>(() => buildCreateForm(currentUserId, defaultCurrencyCode));
  const [initialFormState, setInitialFormState] = useState<EntryEditorFormState>(() =>
    buildCreateForm(currentUserId, defaultCurrencyCode)
  );
  const [editorResetNonce, setEditorResetNonce] = useState(0);
  const [createdEntityOptionNames, setCreatedEntityOptionNames] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (mode === "create") {
      const nextState = buildCreateForm(currentUserId, defaultCurrencyCode);
      setFormState(nextState);
      setInitialFormState(nextState);
      setValidationError(null);
      setEditorResetNonce((value) => value + 1);
      setCreatedEntityOptionNames([]);
      return;
    }

    if (entry) {
      const nextState = buildEditForm(entry);
      setFormState(nextState);
      setInitialFormState(nextState);
      setValidationError(null);
      setEditorResetNonce((value) => value + 1);
      setCreatedEntityOptionNames([]);
    }
  }, [currentUserId, defaultCurrencyCode, entry, isOpen, mode]);

  useEffect(() => {
    if (!isOpen || mode !== "create" || !currentUserId) {
      return;
    }

    setFormState((state) => (state.owner_user_id ? state : { ...state, owner_user_id: currentUserId }));
    setInitialFormState((state) => (state.owner_user_id ? state : { ...state, owner_user_id: currentUserId }));
  }, [currentUserId, isOpen, mode]);

  const editorResetKey = useMemo(() => {
    const scope = mode === "edit" && entry ? `${entry.id}:${entry.updated_at}` : `new:${currentUserId}`;
    return `${scope}:${editorResetNonce}`;
  }, [currentUserId, editorResetNonce, entry, mode]);

  const currencyOptions = useMemo(() => {
    const codes = new Set(currencies.map((currency) => currency.code));
    if (formState.currency_code) {
      codes.add(formState.currency_code.toUpperCase());
    }
    return Array.from(codes).sort();
  }, [currencies, formState.currency_code]);
  const entityOptionNames = useMemo(
    () => uniqueNormalizedEntityNames([...(entities.map((entity) => entity.name) ?? []), ...createdEntityOptionNames]),
    [createdEntityOptionNames, entities]
  );
  const groupOptions = useMemo(
    () => {
      const availableGroups = [...groups];
      if (entry?.direct_group && !availableGroups.some((group) => group.id === entry.direct_group?.id)) {
        availableGroups.push({
          id: entry.direct_group.id,
          name: entry.direct_group.name,
          group_type: entry.direct_group.group_type,
          parent_group_id: null,
          direct_member_count: 0,
          direct_entry_count: 0,
          direct_child_group_count: 0,
          descendant_entry_count: 0,
          first_occurred_at: null,
          last_occurred_at: null
        });
      }

      return [
        { value: "", label: "Ungrouped" },
        ...availableGroups
          .sort((left, right) => left.name.localeCompare(right.name))
        .map((group) => ({
          value: group.id,
          label: `${group.name} · ${group.group_type}${group.parent_group_id ? " · child group" : ""}`
        }))
      ];
    },
    [entry?.direct_group, groups]
  );
  const selectedGroupType = useMemo(
    () =>
      groups.find((group) => group.id === formState.direct_group_id)?.group_type ??
      (entry?.direct_group?.id === formState.direct_group_id ? entry.direct_group.group_type : null),
    [entry?.direct_group, formState.direct_group_id, groups]
  );
  const categoryOptionModels = useMemo(() => buildCategoryOptions(categoryTerms), [categoryTerms]);
  const categoryOptions = useMemo(
    () => [
      { value: "", label: "uncategorized", color: entryCategoryColor(null) },
      ...categoryOptionModels.map((option) => ({
        value: option.leafName,
        label: formatEntryCategoryLabel(option.path.includes("/") ? option.path.replace("/", " / ") : option.path),
        color: entryCategoryColor(option.path)
      }))
    ],
    [categoryOptionModels]
  );
  const categoryDefaultLifecycle = useMemo(
    () => new Map(categoryOptionModels.map((option) => [option.leafName, option.defaultLifecycle] as const)),
    [categoryOptionModels]
  );
  const categoryTermNameSet = useMemo(
    () => new Set(categoryTerms.map((term) => term.name.toLowerCase())),
    [categoryTerms]
  );
  const auxTagOptions = useMemo(
    () => tags.filter((tag) => !categoryTermNameSet.has(tag.name.toLowerCase())),
    [categoryTermNameSet, tags]
  );

  const isDirty = useMemo(
    () =>
      !areFormStatesEqual(formState, initialFormState, {
        includeFromSelectedId: Boolean(entry?.from_entity_missing),
        includeToSelectedId: Boolean(entry?.to_entity_missing)
      }),
    [entry?.from_entity_missing, entry?.to_entity_missing, formState, initialFormState]
  );
  const { cancelSuggestion, isRunning: isTagSuggestionRunning, requestSuggestion } = useEntryTagSuggestion({
    entryTaggingModel,
    buildDraft: buildTagSuggestionDraft,
    onApplySuggestion: (response) =>
      setFormState((state) => ({
        ...state,
        tags: response.suggested_tags,
        category: response.suggested_category ?? state.category,
        lifecycle: response.suggested_lifecycle ?? state.lifecycle
      })),
  });

  useEffect(() => {
    if (!isOpen) {
      cancelSuggestion();
    }
  }, [cancelSuggestion, isOpen]);

  if (!isOpen) {
    return null;
  }

  function buildSubmitPayload(): EntryEditorSubmitPayload | null {
    const amountMinor = Math.round(Number(formState.amount_major) * 100);
    const trimmedName = formState.name.trim();
    const ownerUserId = formState.owner_user_id || currentUserId;
    const fromEntityResolution = resolveEntityInput(
      formState.from_entity_value,
      entities,
      formState.from_entity_selected_id
    );
    const toEntityResolution = resolveEntityInput(formState.to_entity_value, entities, formState.to_entity_selected_id);

    if (!trimmedName) {
      setValidationError("Name is required.");
      return null;
    }
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setValidationError("Amount must be greater than 0.");
      return null;
    }
    if (!formState.occurred_at) {
      setValidationError("Date is required.");
      return null;
    }
    if (!ownerUserId) {
      setValidationError("Owner is required.");
      return null;
    }

    setValidationError(null);
    return {
      kind: formState.kind,
      occurred_at: formState.occurred_at,
      name: trimmedName,
      amount_minor: amountMinor,
      currency_code: formState.currency_code.toUpperCase(),
      from_entity_id: fromEntityResolution.entityId,
      from_entity: fromEntityResolution.entityName,
      to_entity_id: toEntityResolution.entityId,
      to_entity: toEntityResolution.entityName,
      owner_user_id: ownerUserId,
      direct_group_id: formState.direct_group_id || null,
      direct_group_member_role: formState.direct_group_id ? (selectedGroupType === "SPLIT" ? formState.direct_group_member_role : null) : null,
      tags: formState.tags,
      category: formState.category.trim() || null,
      lifecycle: (formState.lifecycle || null) as EntryLifecycle | null,
      markdown_body: formState.markdown_body.trim().length > 0 ? formState.markdown_body : null
    };
  }

  function submitCurrentForm() {
    const payload = buildSubmitPayload();
    if (!payload) {
      return false;
    }
    cancelSuggestion();
    onSubmit(payload);
    return true;
  }

  function buildTagSuggestionDraft(): EntryTagSuggestionRequest {
    const amountMinor = Math.round(Number(formState.amount_major) * 100);
    const fromEntityResolution = resolveEntityInput(
      formState.from_entity_value,
      entities,
      formState.from_entity_selected_id
    );
    const toEntityResolution = resolveEntityInput(formState.to_entity_value, entities, formState.to_entity_selected_id);

    return {
      entry_id: mode === "edit" && entry ? entry.id : null,
      kind: formState.kind,
      occurred_at: formState.occurred_at,
      currency_code: formState.currency_code.trim().toUpperCase(),
      amount_minor: Number.isFinite(amountMinor) && amountMinor > 0 ? amountMinor : null,
      name: formState.name.trim() || null,
      from_entity_id: fromEntityResolution.entityId,
      from_entity: fromEntityResolution.entityName,
      to_entity_id: toEntityResolution.entityId,
      to_entity: toEntityResolution.entityName,
      owner_user_id: formState.owner_user_id || null,
      markdown_body: formState.markdown_body.trim() || null,
      current_tags: Array.from(new Set(formState.tags.map((tag) => tag.trim()).filter(Boolean))),
      current_category: formState.category.trim() || null,
      current_lifecycle: (formState.lifecycle || null) as EntryLifecycle | null,
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitCurrentForm();
  }

  function handleCloseRequest() {
    if (isSaving) {
      return;
    }
    cancelSuggestion();

    if (!isDirty || (mode === "edit" && !entry && !loadError)) {
      setValidationError(null);
      onClose();
      return;
    }

    submitCurrentForm();
  }

  function handleSwapFromAndTo() {
    setFormState((state) => ({
      ...state,
      from_entity_value: state.to_entity_value,
      to_entity_value: state.from_entity_value,
      from_entity_selected_id: state.to_entity_selected_id,
      to_entity_selected_id: state.from_entity_selected_id
    }));
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCloseRequest();
        }
      }}
    >
      <DialogContent
        className="entry-editor-sheet h-[90vh] max-h-[90vh] overflow-y-auto"
        onInteractOutside={(event) => {
          if (isSaving) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isSaving) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="entry-editor-header">
          <DialogTitle>{mode === "create" ? "New Entry" : "Edit Entry"}</DialogTitle>
          <DialogDescription>Close the popup to auto-save changes.</DialogDescription>
        </DialogHeader>

        {mode === "edit" && !entry && !loadError ? <p>Loading entry...</p> : null}
        {loadError ? <p className="error">{loadError}</p> : null}

        {(mode === "create" || entry) && !loadError ? (
          <form id="entry-editor-form" className="entry-editor-page" onSubmit={handleSubmit}>
            <div className="entry-property-line">
              <span className="entry-property-label">Date:</span>
              <Input
                type="date"
                className="entry-property-input"
                aria-label="Date"
                required
                value={formState.occurred_at}
                disabled={isSaving}
                onChange={(event) => setFormState((state) => ({ ...state, occurred_at: event.target.value }))}
              />
            </div>

            <div className="entry-property-line">
              <span className="entry-property-label">Name:</span>
              <Input
                aria-label="Name"
                className="entry-property-input"
                required
                value={formState.name}
                disabled={isSaving}
                onChange={(event) => setFormState((state) => ({ ...state, name: event.target.value }))}
              />
            </div>

            <div className="entry-property-line entry-property-line-group">
              <span className="entry-property-label">Kind:</span>
              <div className="entry-property-group entry-property-group-kind">
                <SingleSelect
                  value={formState.kind}
                  options={KIND_OPTIONS}
                  ariaLabel="Kind"
                  disabled={isSaving}
                  onChange={(nextKind) => setFormState((state) => ({ ...state, kind: nextKind as EntryKind }))}
                />
                <span className="entry-property-inline-label">Amount:</span>
                <Input
                  type="number"
                  aria-label="Amount"
                  className="entry-property-input-sm"
                  min="0"
                  step="0.01"
                  required
                  value={formState.amount_major}
                  disabled={isSaving}
                  onChange={(event) => setFormState((state) => ({ ...state, amount_major: event.target.value }))}
                />
                <span className="entry-property-inline-label">Currency:</span>
                <NativeSelect
                  aria-label="Currency"
                  wrapperClassName="entry-property-input-xs"
                  value={formState.currency_code}
                  disabled={isSaving}
                  onChange={(event) => setFormState((state) => ({ ...state, currency_code: event.target.value }))}
                >
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="entry-property-line entry-property-line-group">
              <span className="entry-property-label">From:</span>
              <div className="grid gap-2">
                <div className="entry-property-group entry-property-group-from-to">
                  <CreatableSingleSelect
                    ariaLabel="From"
                    options={entityOptionNames}
                    placeholder="Select or create entity..."
                    createLabelPrefix="Create entity"
                    value={formState.from_entity_value}
                    disabled={isSaving}
                    onCreateOption={(createdValue) =>
                      setCreatedEntityOptionNames((current) => uniqueNormalizedEntityNames([...current, createdValue]))
                    }
                    onChange={(nextValue, meta) =>
                      setFormState((state) => ({
                        ...state,
                        from_entity_value: nextValue,
                        from_entity_selected_id: nextSelectedEntityId(nextValue, entities, meta)
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-full"
                    aria-label="Swap from and to"
                    disabled={isSaving}
                    onClick={handleSwapFromAndTo}
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                  </Button>
                  <span className="entry-property-inline-label">To:</span>
                  <CreatableSingleSelect
                    ariaLabel="To"
                    options={entityOptionNames}
                    placeholder="Select or create entity..."
                    createLabelPrefix="Create entity"
                    value={formState.to_entity_value}
                    disabled={isSaving}
                    onCreateOption={(createdValue) =>
                      setCreatedEntityOptionNames((current) => uniqueNormalizedEntityNames([...current, createdValue]))
                    }
                    onChange={(nextValue, meta) =>
                      setFormState((state) => ({
                        ...state,
                        to_entity_value: nextValue,
                        to_entity_selected_id: nextSelectedEntityId(nextValue, entities, meta)
                      }))
                    }
                  />
                </div>
                {entry?.from_entity_missing || entry?.to_entity_missing ? (
                  <p className="text-xs text-muted-foreground">
                    Missing entity marker: preserved labels remain visible because the original entity no longer exists.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="entry-property-line entry-property-line-tags">
              <span className="entry-property-label">Tags:</span>
              <div className="entry-property-group entry-property-group-tags">
                <TagMultiSelect
                  options={auxTagOptions}
                  value={formState.tags}
                  ariaLabel="Tags"
                  placeholder="Select or create tags..."
                  createLabelPrefix="Create tag"
                  disabled={isSaving}
                  onChange={(nextTags) => setFormState((state) => ({ ...state, tags: nextTags }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn("entry-tag-suggestion-button group shrink-0", isTagSuggestionRunning && "is-running")}
                  aria-label={isTagSuggestionRunning ? "Stop AI tag suggestion" : "Suggest tags with AI"}
                  title={isTagSuggestionRunning ? "Stop AI tag suggestion" : "Suggest tags with AI"}
                  disabled={isSaving}
                  onClick={() => {
                    void requestSuggestion();
                  }}
                >
                  {isTagSuggestionRunning ? (
                    <>
                      <Loader2 className="entry-tag-suggestion-loader h-4 w-4 animate-spin group-hover:hidden" />
                      <Square className="entry-tag-suggestion-stop hidden h-4 w-4 group-hover:block" />
                    </>
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="entry-property-line entry-property-line-group">
              <span className="entry-property-label">Category:</span>
              <div className="entry-property-group entry-property-group-category">
                <SingleSelect
                  value={formState.category}
                  options={categoryOptions}
                  ariaLabel="Category"
                  placeholder="uncategorized"
                  searchable
                  searchPlaceholder="Search categories..."
                  emptyLabel="No matching categories."
                  minMenuWidth={320}
                  disabled={isSaving}
                  onChange={(nextCategory) => {
                    const defaultLifecycle = nextCategory ? categoryDefaultLifecycle.get(nextCategory) : null;
                    setFormState((state) => ({
                      ...state,
                      category: nextCategory,
                      lifecycle: defaultLifecycle ?? state.lifecycle
                    }));
                  }}
                />
                <span className="entry-property-inline-label">Lifecycle:</span>
                <SingleSelect
                  value={formState.lifecycle}
                  options={LIFECYCLE_OPTIONS}
                  ariaLabel="Lifecycle"
                  disabled={isSaving}
                  onChange={(nextLifecycle) => setFormState((state) => ({ ...state, lifecycle: nextLifecycle }))}
                />
              </div>
            </div>

            <div className="entry-property-line entry-property-line-group">
              <span className="entry-property-label">Group:</span>
              <div className="grid gap-2">
                <div className="entry-property-group entry-property-group-group">
                  <SingleSelect
                    value={formState.direct_group_id}
                    options={groupOptions}
                    ariaLabel="Group"
                    placeholder="Ungrouped"
                    searchable
                    searchPlaceholder="Search groups..."
                    emptyLabel="No matching groups."
                    disabled={isSaving}
                    onChange={(nextValue) =>
                      setFormState((state) => ({
                        ...state,
                        direct_group_id: nextValue,
                        direct_group_member_role: nextValue ? state.direct_group_member_role : "CHILD"
                      }))
                    }
                  />
                  {selectedGroupType === "SPLIT" ? (
                    <>
                      <span className="entry-property-inline-label">Split role:</span>
                      <SingleSelect
                        value={formState.direct_group_member_role}
                        options={SPLIT_ROLE_OPTIONS}
                        ariaLabel="Split role"
                        disabled={isSaving}
                        onChange={(nextValue) =>
                          setFormState((state) => ({ ...state, direct_group_member_role: nextValue as GroupMemberRole }))
                        }
                      />
                    </>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Each entry can belong to one direct group. Choose a child group here if you want the parent path to be derived automatically.
                </p>
              </div>
            </div>

            <div className="entry-property-line entry-property-line-notes">
              <span className="entry-property-label">Notes:</span>
              <div className="entry-editor-markdown">
                <MarkdownBlockEditor
                  markdown={formState.markdown_body}
                  resetKey={editorResetKey}
                  disabled={isSaving}
                  onChange={(markdown) => setFormState((state) => ({ ...state, markdown_body: markdown }))}
                />
              </div>
            </div>

            {isSaving ? <p className="muted">Saving entry...</p> : null}
            {validationError ? <p className="error">{validationError}</p> : null}
            {saveError ? <p className="error">{saveError}</p> : null}
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
