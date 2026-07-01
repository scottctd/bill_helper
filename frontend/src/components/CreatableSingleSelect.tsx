/**
 * CALLING SPEC:
 * - Purpose: render the `CreatableSingleSelect` React UI module.
 * - Inputs: callers that import `frontend/src/components/CreatableSingleSelect.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `CreatableSingleSelect`.
 * - Side effects: React rendering and user event wiring.
 */
import { KeyboardEvent, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { FloatingSelectMenu } from "./ui/floating-select/FloatingSelectMenu";
import {
  onFloatingSelectActionKeyDown,
  onFloatingSelectEscapeKeyDown,
  onFloatingSelectPointerDown
} from "./ui/floating-select/floatingSelectActions";
import { useFloatingSelectMenu } from "./ui/floating-select/useFloatingSelectMenu";

interface CreatableSingleSelectProps {
  options: string[];
  value: string;
  onChange: (nextValue: string, meta?: CreatableSingleSelectChangeMeta) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onCreateOption?: (createdValue: string) => void;
  createLabelPrefix?: string;
}

export interface CreatableSingleSelectChangeMeta {
  source: "input" | "select" | "create";
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

function uniqueNormalized(values: string[]) {
  const uniqueValues: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeValue(trimmed);
    if (!trimmed || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueValues.push(trimmed);
  }
  return uniqueValues.sort((left, right) => left.localeCompare(right));
}

export function CreatableSingleSelect({
  options,
  value,
  onChange,
  placeholder = "Select or create...",
  disabled = false,
  ariaLabel,
  onCreateOption,
  createLabelPrefix = "Create"
}: CreatableSingleSelectProps) {
  const controlRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [createdOptions, setCreatedOptions] = useState<string[]>([]);
  const { rootRef, menuRef, menuStyle, portalNode, isOpen, setIsOpen, openMenu } = useFloatingSelectMenu({
    anchorRef: controlRef,
    disabled
  });

  const normalizedValue = normalizeValue(value);
  const effectiveOptions = useMemo(() => uniqueNormalized([...options, ...createdOptions]), [options, createdOptions]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeValue(value);
    if (!normalizedQuery) {
      return effectiveOptions;
    }
    return effectiveOptions.filter((option) => normalizeValue(option).includes(normalizedQuery));
  }, [effectiveOptions, value]);

  const creatableValue = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const alreadyCreated = createdOptions.some((option) => normalizeValue(option) === normalizeValue(trimmed));
    if (alreadyCreated) {
      return null;
    }
    return trimmed;
  }, [createdOptions, value]);

  function focusInput() {
    if (disabled) {
      return;
    }
    inputRef.current?.focus();
    openMenu();
  }

  function selectValue(nextValue: string, markAsCreated = false) {
    if (markAsCreated) {
      setCreatedOptions((current) => uniqueNormalized([...current, nextValue]));
      onCreateOption?.(nextValue);
    }
    onChange(nextValue, { source: markAsCreated ? "create" : "select" });
    setIsOpen(false);
    requestAnimationFrame(() => inputRef.current?.blur());
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const exactMatch = filteredOptions.find((option) => normalizeValue(option) === normalizedValue);
      if (exactMatch) {
        selectValue(exactMatch);
        return;
      }
      const firstMatch = filteredOptions[0];
      if (firstMatch) {
        selectValue(firstMatch);
        return;
      }
      if (creatableValue) {
        selectValue(creatableValue);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
      return;
    }

    onFloatingSelectEscapeKeyDown(event, () => setIsOpen(false));
  }

  return (
    <div className={`creatable-select ${disabled ? "is-disabled" : ""}`} ref={rootRef}>
      <div className="creatable-select-control" onClick={focusInput} ref={controlRef}>
        <input
          ref={inputRef}
          type="text"
          className="creatable-select-input !h-full !rounded-none !border-0 !bg-transparent !px-0 !py-0 !shadow-none focus-visible:!ring-0"
          aria-label={ariaLabel}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(event) => {
            onChange(event.target.value, { source: "input" });
            openMenu();
          }}
          onFocus={openMenu}
          onKeyDown={onInputKeyDown}
        />
        <button
          type="button"
          aria-label="Toggle options"
          className="creatable-select-toggle"
          disabled={disabled}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setIsOpen((open) => !open);
            if (!isOpen) {
              requestAnimationFrame(() => inputRef.current?.focus());
            }
          }}
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <FloatingSelectMenu
        open={isOpen}
        portalNode={portalNode}
        menuRef={menuRef}
        menuStyle={menuStyle}
        className="creatable-select-menu"
      >
        {filteredOptions.map((option) => {
          const isSelected = normalizeValue(option) === normalizedValue;
          return (
            <button
              key={normalizeValue(option)}
              type="button"
              className={`creatable-select-option ${isSelected ? "is-selected" : ""}`}
              onPointerDown={(event) => onFloatingSelectPointerDown(event, disabled, () => selectValue(option))}
              onKeyDown={(event) => onFloatingSelectActionKeyDown(event, disabled, () => selectValue(option))}
            >
              {option}
            </button>
          );
        })}
        {creatableValue ? (
          <button
            type="button"
            className="creatable-select-option"
            onPointerDown={(event) =>
              onFloatingSelectPointerDown(event, disabled, () => selectValue(creatableValue, true))
            }
            onKeyDown={(event) =>
              onFloatingSelectActionKeyDown(event, disabled, () => selectValue(creatableValue, true))
            }
          >
            {createLabelPrefix} "{creatableValue}"
          </button>
        ) : null}
        {filteredOptions.length === 0 && !creatableValue ? (
          <p className="tag-multiselect-empty">No matching options.</p>
        ) : null}
      </FloatingSelectMenu>
    </div>
  );
}
