/**
 * CALLING SPEC:
 * - Purpose: shared pointer and keyboard handlers for floating select option buttons.
 * - Inputs: DOM events, disabled flag, and option action callbacks.
 * - Outputs: event handler functions that prevent default bubbling before invoking actions.
 * - Side effects: none; handlers mutate event propagation only when invoked.
 */

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

export function onFloatingSelectPointerDown(
  event: ReactPointerEvent<HTMLButtonElement>,
  disabled: boolean,
  action: () => void
) {
  if (disabled || event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  action();
}

export function onFloatingSelectActionKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  disabled: boolean,
  action: () => void
) {
  if (disabled) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    action();
  }
}

export function onFloatingSelectEscapeKeyDown(event: KeyboardEvent, close: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}
