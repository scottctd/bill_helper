/**
 * CALLING SPEC:
 * - Purpose: render the `SingleSelect` React UI module.
 * - Inputs: callers that import `frontend/src/components/SingleSelect.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `SingleSelect`.
 * - Side effects: React rendering and user event wiring.
 */
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { FloatingSelectMenu } from "./ui/floating-select/FloatingSelectMenu";
import {
  onFloatingSelectActionKeyDown,
  onFloatingSelectEscapeKeyDown,
  onFloatingSelectPointerDown
} from "./ui/floating-select/floatingSelectActions";
import { useFloatingSelectMenu } from "./ui/floating-select/useFloatingSelectMenu";

export interface SingleSelectOption {
  value: string;
  label: string;
  color?: string;
}

interface SingleSelectProps {
  options: SingleSelectOption[];
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  minMenuWidth?: number;
}

export function SingleSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  ariaLabel,
  searchable = false,
  searchPlaceholder = "Search...",
  emptyLabel = "No matching options.",
  minMenuWidth
}: SingleSelectProps) {
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const { rootRef, menuRef, menuStyle, portalNode, isOpen, setIsOpen, toggleMenu, closeMenu } = useFloatingSelectMenu({
    anchorRef: controlRef,
    disabled,
    minMenuWidth
  });
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  const filteredOptions = useMemo(() => {
    if (!searchable) {
      return options;
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query, searchable]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    if (searchable) {
      searchInputRef.current?.focus();
    }
  }, [isOpen, searchable]);

  function selectOption(optionValue: string) {
    if (disabled || optionValue === value) {
      setIsOpen(false);
      return;
    }
    onChange(optionValue);
    setIsOpen(false);
  }

  function onControlKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      return;
    }

    onFloatingSelectEscapeKeyDown(event, closeMenu);
  }

  function onOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, optionValue: string) {
    if (disabled) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(optionValue);
      return;
    }
    onFloatingSelectEscapeKeyDown(event, closeMenu);
  }

  function onSearchInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onFloatingSelectEscapeKeyDown(event, closeMenu);
    if (event.key === "Escape") {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const firstOption = filteredOptions[0];
      if (firstOption) {
        selectOption(firstOption.value);
      }
    }
  }

  return (
    <div className={`single-select ${disabled ? "is-disabled" : ""}`} ref={rootRef}>
      <button
        ref={controlRef}
        type="button"
        className="single-select-control"
        onClick={toggleMenu}
        onKeyDown={onControlKeyDown}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
      >
        {selectedOption ? (
          <SelectOptionLabel option={selectedOption} className="single-select-value" />
        ) : (
          <span className="single-select-placeholder">{placeholder}</span>
        )}
        <ChevronDown className="single-select-caret" />
      </button>
      <FloatingSelectMenu
        open={isOpen}
        portalNode={portalNode}
        menuRef={menuRef}
        menuStyle={menuStyle}
        className="single-select-menu"
        role="listbox"
        ariaLabel="Select option"
        search={
          searchable ? (
            <input
              ref={searchInputRef}
              className="select-menu-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchInputKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          ) : undefined
        }
      >
        {filteredOptions.length === 0 ? <p className="tag-multiselect-empty">{emptyLabel}</p> : null}
        {filteredOptions.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`single-select-option ${isSelected ? "is-selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              onPointerDown={(event) => onFloatingSelectPointerDown(event, disabled, () => selectOption(option.value))}
              onKeyDown={(event) => onOptionKeyDown(event, option.value)}
            >
              <SelectOptionLabel option={option} display="menu" />
              <Check className={`single-select-check ${isSelected ? "is-visible" : ""}`} />
            </button>
          );
        })}
      </FloatingSelectMenu>
    </div>
  );
}

function SelectOptionLabel({
  option,
  className,
  display = "control"
}: {
  option: SingleSelectOption;
  className?: string;
  display?: "control" | "menu";
}) {
  if (!option.color) {
    return <span className={className}>{option.label}</span>;
  }
  if (display === "menu") {
    return (
      <span className={`select-option-tone-label ${className ?? ""}`}>
        <span className="select-option-tone-dot" style={{ backgroundColor: option.color }} aria-hidden />
        <span className="truncate">{option.label}</span>
      </span>
    );
  }
  return (
    <span className={`single-select-tone-label ${className ?? ""}`}>
      <span className="single-select-tone-dot" style={{ backgroundColor: option.color }} aria-hidden />
      <span className="truncate">{option.label}</span>
    </span>
  );
}
