/**
 * CALLING SPEC:
 * - Purpose: pure presentation helpers for entry rows in the entries workspace.
 * - Inputs: entry field values (kind, entities, currency codes).
 * - Outputs: CSS class names, compact labels, and flow text for table cells.
 * - Side effects: none.
 */
import { kindLabel, kindSymbol } from "../../lib/format";

export { kindLabel, kindSymbol };

const ENTRY_FLOW_LABEL_MAX_LENGTH = 18;
export const MISSING_ENTITY_LABEL = "(unspecified)";
export const MISSING_ENTITY_MARKER_LABEL = "Missing entity";

export function kindToneClass(kind: string): string {
  if (kind === "INCOME") return "entries-amount-marker-income";
  if (kind === "TRANSFER") return "entries-amount-marker-transfer";
  return "entries-amount-marker-expense";
}

export function normalizedCurrencyCode(currencyCode: string): string {
  return currencyCode.trim().toUpperCase() || "CAD";
}

function normalizedEntityLabel(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function compactEntityLabel(value: string, maxLength: number = ENTRY_FLOW_LABEL_MAX_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  const ellipsis = "...";
  const remainingLength = Math.max(maxLength - ellipsis.length, 2);
  const prefixLength = Math.ceil(remainingLength / 2);
  const suffixLength = Math.max(remainingLength - prefixLength, 1);
  return `${value.slice(0, prefixLength)}${ellipsis}${value.slice(-suffixLength)}`;
}

export function entryFlowLabel(fromEntity: string | null, toEntity: string | null): { display: string; full: string } | null {
  const normalizedFrom = normalizedEntityLabel(fromEntity);
  const normalizedTo = normalizedEntityLabel(toEntity);
  if (!normalizedFrom && !normalizedTo) {
    return null;
  }

  const fullFrom = normalizedFrom ?? MISSING_ENTITY_LABEL;
  const fullTo = normalizedTo ?? MISSING_ENTITY_LABEL;
  return {
    display: `${compactEntityLabel(fullFrom)} -> ${compactEntityLabel(fullTo)}`,
    full: `${fullFrom} -> ${fullTo}`
  };
}
