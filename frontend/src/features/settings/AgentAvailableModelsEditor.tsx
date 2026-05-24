/**
 * CALLING SPEC:
 * - Purpose: unified CRUD UI for agent model ids and optional display labels.
 * - Inputs: settings form slice and patch handler from `SettingsAgentSection`.
 * - Outputs: table-style editor with add, remove, reorder, and two fields per row.
 * - Side effects: calls `onFormPatch` when the effective model list or labels change.
 */
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  type AgentModelRow,
  buildAgentModelSettingsPatchFromRows,
  rowsFromAgentModelFormState,
} from "../../lib/agent_models";
import type { SettingsFormPatch, SettingsFormState } from "./types";

interface AgentAvailableModelsEditorProps {
  formState: SettingsFormState;
  onFormPatch: (patch: SettingsFormPatch) => void;
  fieldId: string;
}

type EditorModelRow = AgentModelRow & { clientId: string };

function createEditorRow(row: AgentModelRow = { modelId: "", displayName: "" }): EditorModelRow {
  return { ...row, clientId: crypto.randomUUID() };
}

function editorRowsFromFormState(formState: SettingsFormState): EditorModelRow[] {
  return rowsFromAgentModelFormState(formState).map((row) => createEditorRow(row));
}

function stripClientIds(rows: EditorModelRow[]): AgentModelRow[] {
  return rows.map(({ modelId, displayName }) => ({ modelId, displayName }));
}

function patchesMatchFormState(
  rows: EditorModelRow[],
  formState: SettingsFormState
): boolean {
  const patch = buildAgentModelSettingsPatchFromRows(stripClientIds(rows), {
    agent_model: formState.agent_model,
    entry_tagging_model: formState.entry_tagging_model,
  });
  return (
    patch.available_agent_models === formState.available_agent_models &&
    patch.agent_model === formState.agent_model &&
    patch.entry_tagging_model === formState.entry_tagging_model &&
    JSON.stringify(patch.agent_model_display_names) === JSON.stringify(formState.agent_model_display_names)
  );
}

export function AgentAvailableModelsEditor({ formState, onFormPatch, fieldId }: AgentAvailableModelsEditorProps) {
  const [pendingRow, setPendingRow] = useState<EditorModelRow | null>(null);
  const rowStateRef = useRef<EditorModelRow[] | null>(null);

  const baseRows = editorRowsFromFormState(formState);

  function getRows(): EditorModelRow[] {
    return rowStateRef.current ?? baseRows;
  }

  const committedRows = getRows();
  const displayRows = pendingRow ? [...committedRows, pendingRow] : committedRows;
  const committedRowCount = committedRows.length;

  const context = {
    agent_model: formState.agent_model,
    entry_tagging_model: formState.entry_tagging_model,
  };

  useEffect(() => {
    const refRows = rowStateRef.current;
    if (refRows && patchesMatchFormState(refRows, formState)) {
      return;
    }
    rowStateRef.current = null;
    setPendingRow(null);
  }, [
    formState.available_agent_models,
    formState.agent_model_display_names,
    formState.agent_model,
    formState.entry_tagging_model,
  ]);

  function commit(nextBaseRows: EditorModelRow[]) {
    rowStateRef.current = nextBaseRows;
    onFormPatch(buildAgentModelSettingsPatchFromRows(stripClientIds(nextBaseRows), context));
  }

  function handleAdd() {
    if (pendingRow) {
      return;
    }
    setPendingRow(createEditorRow());
  }

  function handleModelIdChange(index: number, value: string) {
    if (pendingRow !== null && index === committedRowCount) {
      const next = { ...pendingRow, modelId: value };
      setPendingRow(next);
      if (value.trim()) {
        commit([...getRows(), next]);
        setPendingRow(null);
      }
      return;
    }
    commit(getRows().map((row, i) => (i === index ? { ...row, modelId: value } : row)));
  }

  function handleDisplayNameChange(index: number, value: string) {
    if (pendingRow !== null && index === committedRowCount) {
      setPendingRow({ ...pendingRow, displayName: value });
      return;
    }
    commit(getRows().map((row, i) => (i === index ? { ...row, displayName: value } : row)));
  }

  function handleRemove(index: number) {
    if (pendingRow !== null && index === committedRowCount) {
      setPendingRow(null);
      return;
    }
    commit(getRows().filter((_, i) => i !== index));
  }

  function handleMove(index: number, delta: -1 | 1) {
    if (pendingRow !== null && index >= committedRowCount) {
      return;
    }
    const rows = getRows();
    const j = index + delta;
    if (j < 0 || j >= rows.length) {
      return;
    }
    const next = [...rows];
    [next[index], next[j]] = [next[j]!, next[index]!];
    commit(next);
  }

  return (
    <div id={fieldId} className="grid gap-2">
      <div className="hidden gap-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:px-1">
        <span>Model id</span>
        <span>Display name</span>
        <span className="sr-only">Row actions</span>
      </div>

      {displayRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No models configured. Add a model id to enable the agent picker.</p>
      ) : null}

      {displayRows.length > 0 ? (
      <div className="grid max-h-72 gap-2 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-3">
        {displayRows.map((row, index) => {
          const isPendingRow = pendingRow !== null && index === committedRowCount;
          const canMoveUp = !isPendingRow && index > 0;
          const canMoveDown = !isPendingRow && index < committedRowCount - 1;
          return (
            <div
              key={row.clientId}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground sm:hidden" htmlFor={`${fieldId}-id-${row.clientId}`}>
                  Model id
                </label>
                <Input
                  id={`${fieldId}-id-${row.clientId}`}
                  className="font-mono text-xs"
                  placeholder="provider/model-id"
                  autoComplete="off"
                  aria-label={`Model id, row ${index + 1}`}
                  value={row.modelId}
                  onChange={(event) => handleModelIdChange(index, event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground sm:hidden" htmlFor={`${fieldId}-label-${row.clientId}`}>
                  Display name
                </label>
                <Input
                  id={`${fieldId}-label-${row.clientId}`}
                  placeholder="Optional label"
                  autoComplete="off"
                  aria-label={`Display name, row ${index + 1}`}
                  value={row.displayName}
                  onChange={(event) => handleDisplayNameChange(index, event.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-0.5 sm:justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Move model row ${index + 1} up`}
                  disabled={!canMoveUp}
                  onClick={() => handleMove(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Move model row ${index + 1} down`}
                  disabled={!canMoveDown}
                  onClick={() => handleMove(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  aria-label={`Remove model row ${index + 1}`}
                  onClick={() => handleRemove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      ) : null}

      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" disabled={Boolean(pendingRow)} onClick={handleAdd}>
        <Plus className="h-4 w-4" />
        Add model
      </Button>
    </div>
  );
}
