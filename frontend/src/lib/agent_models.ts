/**
 * CALLING SPEC:
 * - Purpose: shared helpers for agent model ids, display labels, and reasoning efforts.
 * - Inputs: model id lists and label maps from runtime settings or form state.
 * - Outputs: pruned maps, newline model lists, row normalization, and user-facing option labels.
 * - Side effects: none.
 */

export function parseAgentModelLines(rawValue: string): string[] {
  const items: string[] = [];
  const seenKeys = new Set<string>();

  for (const line of rawValue.split(/\r?\n/)) {
    const item = line.trim();
    if (!item) {
      continue;
    }
    const itemKey = item.toLocaleLowerCase();
    if (seenKeys.has(itemKey)) {
      continue;
    }
    seenKeys.add(itemKey);
    items.push(item);
  }

  return items;
}

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type AgentModelRow = { modelId: string; displayName: string; reasoningEffort: ReasoningEffort | "" };

export function rowsFromAgentModelFormState(state: {
  available_agent_models: string;
  agent_model_display_names: Record<string, string>;
  agent_model_reasoning_efforts: Record<string, ReasoningEffort>;
}): AgentModelRow[] {
  const ids = parseAgentModelLines(state.available_agent_models);
  return ids.map((id) => ({
    modelId: id,
    displayName: state.agent_model_display_names[id] ?? "",
    reasoningEffort: state.agent_model_reasoning_efforts[id] ?? "",
  }));
}

export function normalizeAgentModelRows(rows: AgentModelRow[]): {
  modelIds: string[];
  displayNames: Record<string, string>;
  reasoningEfforts: Record<string, ReasoningEffort>;
  availableAgentModelsText: string;
} {
  const seen = new Set<string>();
  const modelIds: string[] = [];
  const displayNames: Record<string, string> = {};
  const reasoningEfforts: Record<string, ReasoningEffort> = {};
  for (const row of rows) {
    const id = row.modelId.trim();
    if (!id) {
      continue;
    }
    const fold = id.toLowerCase();
    if (seen.has(fold)) {
      continue;
    }
    seen.add(fold);
    modelIds.push(id);
    const label = row.displayName.trim();
    if (label) {
      displayNames[id] = label;
    }
    if (row.reasoningEffort) {
      reasoningEfforts[id] = row.reasoningEffort;
    }
  }
  return {
    modelIds,
    displayNames,
    reasoningEfforts,
    availableAgentModelsText: modelIds.join("\n"),
  };
}

export function buildAgentModelSettingsPatchFromRows(
  rows: AgentModelRow[],
  context: { agent_model: string; entry_tagging_model: string }
): {
  available_agent_models: string;
  agent_model: string;
  entry_tagging_model: string;
  agent_model_display_names: Record<string, string>;
  agent_model_reasoning_efforts: Record<string, ReasoningEffort>;
} {
  const { modelIds, displayNames, reasoningEfforts, availableAgentModelsText } = normalizeAgentModelRows(rows);
  const nextDefault =
    modelIds.length === 0 ? "" : modelIds.includes(context.agent_model) ? context.agent_model : modelIds[0]!;
  const taggingTrim = context.entry_tagging_model.trim();
  const nextTagging = taggingTrim && modelIds.includes(taggingTrim) ? taggingTrim : "";
  return {
    available_agent_models: availableAgentModelsText,
    agent_model: nextDefault,
    entry_tagging_model: nextTagging,
    agent_model_display_names: displayNames,
    agent_model_reasoning_efforts: reasoningEfforts,
  };
}

export function pruneAgentModelDisplayNames(
  names: Record<string, string>,
  modelIds: string[]
): Record<string, string> {
  const canonicalByFold = new Map(modelIds.map((id) => [id.toLowerCase(), id] as const));
  const next: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(names)) {
    const canonical = canonicalByFold.get(rawKey.toLowerCase());
    if (!canonical) {
      continue;
    }
    const trimmed = rawVal.trim();
    if (trimmed) {
      next[canonical] = trimmed;
    }
  }
  return next;
}

export function pruneAgentModelReasoningEfforts(
  efforts: Record<string, ReasoningEffort>,
  modelIds: string[]
): Record<string, ReasoningEffort> {
  const canonicalByFold = new Map(modelIds.map((id) => [id.toLowerCase(), id] as const));
  const next: Record<string, ReasoningEffort> = {};
  for (const [rawKey, effort] of Object.entries(efforts)) {
    const canonical = canonicalByFold.get(rawKey.toLowerCase());
    if (canonical && REASONING_EFFORTS.includes(effort)) {
      next[canonical] = effort;
    }
  }
  return next;
}

export function resolveAgentModelOptionLabel(
  modelId: string,
  displayNames: Record<string, string> | undefined
): string {
  const label = displayNames?.[modelId]?.trim();
  return label || modelId;
}
