/**
 * CALLING SPEC:
 * - Purpose: define entry-editor form contracts and deterministic state/entity helpers.
 * - Inputs: entries, entities, raw form values, and select change metadata.
 * - Outputs: normalized form state, submit contracts, and entity resolution results.
 * - Side effects: none.
 */
import type { CreatableSingleSelectChangeMeta } from "./CreatableSingleSelect";
import { categoryPathLeaf } from "../lib/catalogs";
import type {
  Entity,
  Entry,
  EntryKind,
  EntryLifecycle,
  GroupMemberRole
} from "../lib/types";
import { formatEntryLifecycle } from "../lib/catalogs";
import { entryLifecycleColor } from "../lib/entryClassificationColors";

export interface EntryEditorFormState {
  kind: EntryKind;
  occurred_at: string;
  name: string;
  amount_major: string;
  currency_code: string;
  from_entity_value: string;
  to_entity_value: string;
  from_entity_selected_id: string | null;
  to_entity_selected_id: string | null;
  owner_user_id: string;
  direct_group_id: string;
  direct_group_member_role: GroupMemberRole;
  tags: string[];
  category: string;
  lifecycle: string;
  markdown_body: string;
}

export interface EntryEditorSubmitPayload {
  kind: EntryKind;
  occurred_at: string;
  name: string;
  amount_minor: number;
  currency_code: string;
  from_entity_id: string | null;
  from_entity: string | null;
  to_entity_id: string | null;
  to_entity: string | null;
  owner_user_id: string;
  direct_group_id: string | null;
  direct_group_member_role: GroupMemberRole | null;
  tags: string[];
  category: string | null;
  lifecycle: EntryLifecycle | null;
  markdown_body: string | null;
}

export const KIND_OPTIONS: Array<{ value: EntryKind; label: string }> = [
  { value: "INCOME", label: "+ Income" },
  { value: "EXPENSE", label: "- Expense" },
  { value: "TRANSFER", label: "~ Transfer" }
];

export const LIFECYCLE_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: "", label: "none", color: entryLifecycleColor(null) },
  ...(["fixed", "day_to_day", "one_time"] as EntryLifecycle[]).map((value) => ({
    value,
    label: formatEntryLifecycle(value),
    color: entryLifecycleColor(value)
  }))
];

export const SPLIT_ROLE_OPTIONS: Array<{
  value: GroupMemberRole;
  label: string;
}> = [
  { value: "CHILD", label: "Child" },
  { value: "PARENT", label: "Parent" }
];

function todayDateInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function buildCreateForm(
  currentUserId: string,
  defaultCurrencyCode: string
): EntryEditorFormState {
  return {
    kind: "EXPENSE",
    occurred_at: todayDateInputValue(),
    name: "",
    amount_major: "",
    currency_code: defaultCurrencyCode,
    from_entity_value: "",
    to_entity_value: "",
    from_entity_selected_id: null,
    to_entity_selected_id: null,
    owner_user_id: currentUserId,
    direct_group_id: "",
    direct_group_member_role: "CHILD",
    tags: [],
    category: "",
    lifecycle: "",
    markdown_body: ""
  };
}

export function buildEditForm(entry: Entry): EntryEditorFormState {
  return {
    kind: entry.kind,
    occurred_at: entry.occurred_at,
    name: entry.name,
    amount_major: `${(entry.amount_minor / 100).toFixed(2)}`,
    currency_code: entry.currency_code,
    from_entity_value: entry.from_entity ?? "",
    to_entity_value: entry.to_entity ?? "",
    from_entity_selected_id: entry.from_entity_id,
    to_entity_selected_id: entry.to_entity_id,
    owner_user_id: entry.owner_user_id,
    direct_group_id: entry.direct_group?.id ?? "",
    direct_group_member_role: entry.direct_group_member_role ?? "CHILD",
    tags: entry.tags.map((tag) => tag.name),
    category: categoryPathLeaf(entry.category) ?? "",
    lifecycle: entry.lifecycle ?? "",
    markdown_body: entry.markdown_body ?? ""
  };
}

function normalizeTagValues(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
        .sort((left, right) => left.localeCompare(right))
    )
  );
}

function normalizeAmountForDiff(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value.trim();
}

function normalizeFormStateForDiff(
  state: EntryEditorFormState,
  options?: {
    includeFromSelectedId?: boolean;
    includeToSelectedId?: boolean;
  }
) {
  return {
    kind: state.kind,
    occurred_at: state.occurred_at,
    name: state.name.trim(),
    amount_major: normalizeAmountForDiff(state.amount_major),
    currency_code: state.currency_code.trim().toUpperCase(),
    from_entity_value: state.from_entity_value.trim(),
    to_entity_value: state.to_entity_value.trim(),
    from_entity_selected_id: options?.includeFromSelectedId
      ? state.from_entity_selected_id
      : null,
    to_entity_selected_id: options?.includeToSelectedId
      ? state.to_entity_selected_id
      : null,
    owner_user_id: state.owner_user_id,
    direct_group_id: state.direct_group_id,
    direct_group_member_role: state.direct_group_id
      ? state.direct_group_member_role
      : null,
    tags: normalizeTagValues(state.tags),
    category: state.category.trim().toLowerCase(),
    lifecycle: state.lifecycle,
    markdown_body: state.markdown_body.trim()
  };
}

function normalizeEntityValue(value: string) {
  return value.trim().toLowerCase();
}

export function uniqueNormalizedEntityNames(values: string[]) {
  const uniqueValues: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeEntityValue(trimmed);
    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueValues.push(trimmed);
  }
  return uniqueValues.sort((left, right) => left.localeCompare(right));
}

export function resolveEntityInput(
  rawValue: string,
  entities: Entity[],
  selectedEntityId: string | null = null
) {
  const trimmed = rawValue.trim();
  if (!trimmed) return { entityId: null, entityName: null };

  if (selectedEntityId) {
    const selectedEntity = entities.find(
      (entity) => entity.id === selectedEntityId
    );
    if (
      selectedEntity &&
      normalizeEntityValue(selectedEntity.name) === normalizeEntityValue(trimmed)
    ) {
      return { entityId: selectedEntity.id, entityName: null };
    }
  }

  const matchedEntity = entities.find(
    (entity) =>
      normalizeEntityValue(entity.name) === normalizeEntityValue(trimmed)
  );
  return matchedEntity
    ? { entityId: matchedEntity.id, entityName: null }
    : { entityId: null, entityName: trimmed };
}

export function areFormStatesEqual(
  left: EntryEditorFormState,
  right: EntryEditorFormState,
  options?: {
    includeFromSelectedId?: boolean;
    includeToSelectedId?: boolean;
  }
) {
  return (
    JSON.stringify(normalizeFormStateForDiff(left, options)) ===
    JSON.stringify(normalizeFormStateForDiff(right, options))
  );
}

function matchingEntityId(value: string, entities: Entity[]) {
  const normalized = normalizeEntityValue(value);
  if (!normalized) return null;
  return (
    entities.find(
      (entity) => normalizeEntityValue(entity.name) === normalized
    )?.id ?? null
  );
}

export function nextSelectedEntityId(
  nextValue: string,
  entities: Entity[],
  meta?: CreatableSingleSelectChangeMeta
) {
  return meta?.source === "select"
    ? matchingEntityId(nextValue, entities)
    : null;
}
