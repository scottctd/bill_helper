/**
 * CALLING SPEC:
 * - Purpose: humanize proposal field labels and values for read-only review cards.
 * - Inputs: raw diff-derived label/value strings and optional payload context.
 * - Outputs: title-cased labels and formatted amounts, tags, kinds, and booleans.
 * - Side effects: none.
 */

import { formatMinor } from "../../lib/format";
import type { ProposalFieldRow, ProposalFields } from "./proposalFields";

const MONEY_FIELD_LABELS = new Set(["amount", "balance"]);

function titleCaseWords(text: string): string {
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function humanizeFieldLabel(label: string): string {
  return titleCaseWords(label.trim());
}

function parseIntegerMinor(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function humanizeTagsValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return "";
    }
    return inner
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join(", ");
  }
  return value;
}

function humanizeKindValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
}

function humanizeBooleanValue(label: string, value: string): string {
  if (value === "true") {
    return label === "active" ? "Active" : "Yes";
  }
  if (value === "false") {
    return label === "active" ? "Inactive" : "No";
  }
  return value;
}

function humanizeMoneyValue(value: string, currencyCode?: string): string {
  const minor = parseIntegerMinor(value);
  if (minor === null) {
    return value;
  }
  if (currencyCode) {
    return formatMinor(minor, currencyCode);
  }
  return String(minor / 100);
}

export function humanizeFieldValue(label: string, value: string, currencyCode?: string): string {
  const normalizedLabel = label.trim().toLowerCase();

  if (normalizedLabel === "tags") {
    return humanizeTagsValue(value);
  }
  if (normalizedLabel === "kind") {
    return humanizeKindValue(value);
  }
  if (MONEY_FIELD_LABELS.has(normalizedLabel)) {
    return humanizeMoneyValue(value, currencyCode);
  }
  return humanizeBooleanValue(normalizedLabel, value);
}

function resolveCurrencyCode(payload: Record<string, unknown>, rows: ProposalFieldRow[]): string | undefined {
  const payloadCurrency = payload.currency_code;
  if (typeof payloadCurrency === "string" && payloadCurrency.trim()) {
    return payloadCurrency;
  }

  const memberPreview = payload.member_preview;
  if (memberPreview && typeof memberPreview === "object" && !Array.isArray(memberPreview)) {
    const previewCurrency = (memberPreview as Record<string, unknown>).currency_code;
    if (typeof previewCurrency === "string" && previewCurrency.trim()) {
      return previewCurrency;
    }
  }

  const currencyRow = rows.find((row) => row.label.trim().toLowerCase() === "currency");
  if (currencyRow?.value?.trim()) {
    return currencyRow.value;
  }

  return undefined;
}

function valueIncludesCurrencyPrefix(value?: string): boolean {
  return Boolean(value?.trim().match(/^[A-Z]{3}\s/));
}

function moneyRowIncludesCurrencyPrefix(row: ProposalFieldRow): boolean {
  const normalizedLabel = row.label.trim().toLowerCase();
  if (normalizedLabel !== "amount" && normalizedLabel !== "balance") {
    return false;
  }
  return valueIncludesCurrencyPrefix(row.value) || valueIncludesCurrencyPrefix(row.before) || valueIncludesCurrencyPrefix(row.after);
}

function dropRedundantCurrencyRow(rows: ProposalFieldRow[]): ProposalFieldRow[] {
  const moneyRow = rows.find((row) => moneyRowIncludesCurrencyPrefix(row));
  if (!moneyRow) {
    return rows;
  }
  return rows.filter((row) => row.label.trim().toLowerCase() !== "currency");
}

function humanizeRow(row: ProposalFieldRow, currencyCode?: string): ProposalFieldRow {
  const label = humanizeFieldLabel(row.label);
  if (row.value !== undefined) {
    return {
      ...row,
      label,
      value: humanizeFieldValue(row.label, row.value, currencyCode)
    };
  }
  return {
    ...row,
    label,
    before: row.before ? humanizeFieldValue(row.label, row.before, currencyCode) : row.before,
    after: row.after ? humanizeFieldValue(row.label, row.after, currencyCode) : row.after
  };
}

export function humanizeProposalFields(fields: ProposalFields, payload: Record<string, unknown>): ProposalFields {
  const currencyCode = resolveCurrencyCode(payload, fields.rows);
  const rows = dropRedundantCurrencyRow(fields.rows.map((row) => humanizeRow(row, currencyCode)));
  return {
    ...fields,
    rows
  };
}
