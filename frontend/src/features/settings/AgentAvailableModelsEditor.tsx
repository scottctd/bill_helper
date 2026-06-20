/**
 * CALLING SPEC:
 * - Purpose: unified CRUD UI for agent model ids and optional display labels.
 * - Inputs: settings form slice and patch handler from `SettingsAgentSection`.
 * - Outputs: table-style editor with add, remove, drag reorder, and two fields per row.
 * - Side effects: calls `onFormPatch` when the effective model list or labels change.
 */
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
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

interface ModelRowEditorProps {
  fieldId: string;
  index: number;
  row: EditorModelRow;
  dragHandle?: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
    isDragging: boolean;
  };
  onModelIdChange: (index: number, value: string) => void;
  onDisplayNameChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}

const MODEL_ROW_GRID_CLASS =
  "grid items-center gap-1 sm:grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)_1.75rem] sm:gap-x-1.5";
const MODEL_ROW_PAD_CLASS = "px-2";
const compactInputClass = "h-8 px-2 py-1 text-xs";
const rowActionClass = "h-7 w-7 shrink-0";

function ModelRowEditor({
  fieldId,
  index,
  row,
  dragHandle,
  onModelIdChange,
  onDisplayNameChange,
  onRemove,
}: ModelRowEditorProps) {
  return (
    <div className={cn(MODEL_ROW_GRID_CLASS, "py-0.5", dragHandle?.isDragging && "rounded-sm bg-background/90")}>
      {dragHandle ? (
        <Button
          ref={dragHandle.setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(rowActionClass, "cursor-grab touch-none text-muted-foreground active:cursor-grabbing")}
          aria-label={`Drag to reorder model row ${index + 1}`}
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <span className={cn(rowActionClass, "inline-flex")} aria-hidden />
      )}
      <div className="grid min-w-0 gap-0.5">
        <label className="text-label-12 font-medium text-muted-foreground sm:hidden" htmlFor={`${fieldId}-id-${row.clientId}`}>
          Model id
        </label>
        <Input
          id={`${fieldId}-id-${row.clientId}`}
          className={cn(compactInputClass, "font-mono")}
          placeholder="provider/model-id"
          autoComplete="off"
          aria-label={`Model id, row ${index + 1}`}
          value={row.modelId}
          onChange={(event) => onModelIdChange(index, event.target.value)}
        />
      </div>
      <div className="grid min-w-0 gap-0.5">
        <label className="text-label-12 font-medium text-muted-foreground sm:hidden" htmlFor={`${fieldId}-label-${row.clientId}`}>
          Display name
        </label>
        <Input
          id={`${fieldId}-label-${row.clientId}`}
          className={compactInputClass}
          placeholder="Optional label"
          autoComplete="off"
          aria-label={`Display name, row ${index + 1}`}
          value={row.displayName}
          onChange={(event) => onDisplayNameChange(index, event.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(rowActionClass, "text-destructive hover:text-destructive")}
        aria-label={`Remove model row ${index + 1}`}
        onClick={() => onRemove(index)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface SortableModelRowProps {
  fieldId: string;
  index: number;
  row: EditorModelRow;
  onModelIdChange: (index: number, value: string) => void;
  onDisplayNameChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}

function SortableModelRow({
  fieldId,
  index,
  row,
  onModelIdChange,
  onDisplayNameChange,
  onRemove,
}: SortableModelRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.clientId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ModelRowEditor
        fieldId={fieldId}
        index={index}
        row={row}
        dragHandle={{ attributes, listeners, setActivatorNodeRef, isDragging }}
        onModelIdChange={onModelIdChange}
        onDisplayNameChange={onDisplayNameChange}
        onRemove={onRemove}
      />
    </div>
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
  const committedRowCount = committedRows.length;
  const hasRows = committedRows.length > 0 || pendingRow !== null;

  const context = {
    agent_model: formState.agent_model,
    entry_tagging_model: formState.entry_tagging_model,
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const rows = getRows();
    const oldIndex = rows.findIndex((row) => row.clientId === active.id);
    const newIndex = rows.findIndex((row) => row.clientId === over.id);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    commit(arrayMove(rows, oldIndex, newIndex));
  }

  return (
    <div id={fieldId} className="grid gap-1.5">
      {!hasRows ? (
        <p className="text-sm text-muted-foreground">No models configured. Add a model id to enable the agent picker.</p>
      ) : null}

      {hasRows ? (
        <div
          className={cn(
            "max-h-60 overflow-y-auto rounded-md border border-border/60 bg-muted/30 [scrollbar-gutter:stable]"
          )}
        >
          <div
            className={cn(
              MODEL_ROW_GRID_CLASS,
              MODEL_ROW_PAD_CLASS,
              "sticky top-0 z-10 hidden border-b border-border/50 bg-background py-1 text-label-12 font-medium text-muted-foreground sm:grid"
            )}
            aria-hidden
          >
            <span />
            <span className="min-w-0 whitespace-nowrap">Model id</span>
            <span className="min-w-0 whitespace-nowrap">Display name</span>
            <span />
          </div>
          <div className={cn(MODEL_ROW_PAD_CLASS, "divide-y divide-border/50 py-1")}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={committedRows.map((row) => row.clientId)} strategy={verticalListSortingStrategy}>
                {committedRows.map((row, index) => (
                  <SortableModelRow
                    key={row.clientId}
                    fieldId={fieldId}
                    index={index}
                    row={row}
                    onModelIdChange={handleModelIdChange}
                    onDisplayNameChange={handleDisplayNameChange}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {pendingRow ? (
              <ModelRowEditor
                fieldId={fieldId}
                index={committedRowCount}
                row={pendingRow}
                onModelIdChange={handleModelIdChange}
                onDisplayNameChange={handleDisplayNameChange}
                onRemove={handleRemove}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" disabled={Boolean(pendingRow)} onClick={handleAdd}>
        <Plus className="h-4 w-4" />
        Add model
      </Button>
    </div>
  );
}
