/**
 * CALLING SPEC:
 * - Purpose: provide the `format` frontend module.
 * - Inputs: callers that import `frontend/src/lib/format.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `format`.
 * - Side effects: module-local frontend behavior only.
 */
export function formatMinor(amountMinor: number, currencyCode: string): string {
  const normalizedCurrencyCode = currencyCode.trim().toUpperCase() || "CAD";
  const value = amountMinor / 100;
  const amountText = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
  return `${normalizedCurrencyCode} ${amountText}`;
}

export function formatUsd(amountUsd: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(amountUsd);
}

export function formatMinorCompact(amountMinor: number): string {
  const value = amountMinor / 100;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

export function currentMonth(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

export function kindLabel(kind: string): string {
  if (kind === "INCOME") return "Income";
  if (kind === "TRANSFER") return "Transfer";
  return "Expense";
}

export function kindSymbol(kind: string): string {
  if (kind === "INCOME") return "+";
  if (kind === "TRANSFER") return "~";
  return "-";
}

export function groupRangeLabel(summary: {
  first_occurred_at?: string | null;
  last_occurred_at?: string | null;
}): string {
  const first = summary.first_occurred_at ?? null;
  const last = summary.last_occurred_at ?? null;
  if (!first || !last) {
    return "No entries yet";
  }
  if (first === last) {
    return first;
  }
  return `${first} to ${last}`;
}
