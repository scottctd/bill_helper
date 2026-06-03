/**
 * CALLING SPEC:
 * - Purpose: provide the `helpers` frontend module.
 * - Inputs: callers that import `frontend/src/features/agent/panel/helpers.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `helpers`.
 * - Side effects: module-local frontend behavior only.
 */
import type { AgentThreadDetail, AgentToolCall, RuntimeSettings } from "../../../lib/types";

export function normalizeThreadTitleValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function extractRenameThreadTitle(toolCall: AgentToolCall): string | null {
  const outputTitle = normalizeThreadTitleValue(toolCall.output_json?.title);
  if (outputTitle) {
    return outputTitle;
  }
  return normalizeThreadTitleValue(toolCall.input_json?.title);
}

export function normalizeModelName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export { resolveAgentModelOptionLabel } from "../../../lib/agent_models";

export function resolveComposerModelName(
  availableModels: string[],
  threadDetail?: { runs: { model_name: string | null }[]; configured_model_name: string | null },
  runtimeSettings?: RuntimeSettings
): string {
  const latestRunModelName = normalizeModelName(threadDetail?.runs.at(-1)?.model_name);
  const configuredModelName = normalizeModelName(threadDetail?.configured_model_name);
  const runtimeDefaultModelName = normalizeModelName(runtimeSettings?.agent_model);
  const fallbackModelName = normalizeModelName(availableModels[0]);

  if (availableModels.length === 0) {
    return "";
  }

  for (const candidate of [latestRunModelName, configuredModelName, runtimeDefaultModelName, fallbackModelName]) {
    if (candidate && availableModels.includes(candidate)) {
      return candidate;
    }
  }

  return fallbackModelName ?? "";
}

export function resolveRunStreamBuffer(
  runId: string | null | undefined,
  activeStreamRunId: string | null,
  activeBuffer: string,
  buffersByRunId: Record<string, string>
): string {
  if (!runId) {
    return "";
  }
  if (runId === activeStreamRunId) {
    return activeBuffer;
  }
  return buffersByRunId[runId] ?? "";
}
