/**
 * CALLING SPEC:
 * - Purpose: render the unified Income / Expense / Net summary hero for the dashboard.
 * - Inputs: period-scoped KPI totals, currency code, and view mode label context.
 * - Outputs: a single hero card with color-coded income, expense, and net values.
 * - Side effects: React rendering only.
 */

import { ArrowDown, ArrowUp, Banknote, Minus } from "lucide-react";

import { formatMinor } from "../../lib/format";
import { cn } from "../../lib/utils";
import type { DashboardViewMode } from "./helpers";

type DashboardSummaryHeroProps = {
  viewMode: DashboardViewMode;
  selectedYear: number;
  currencyCode: string;
  incomeTotalMinor: number;
  expenseTotalMinor: number;
  netTotalMinor: number;
  cashWithdrawalTotalMinor: number;
  expenseLessOneTimeTotalMinor: number;
};

function netTone(netTotalMinor: number): "success" | "danger" | "default" {
  if (netTotalMinor > 0) return "success";
  if (netTotalMinor < 0) return "danger";
  return "default";
}

export function DashboardSummaryHero({
  viewMode,
  selectedYear,
  currencyCode,
  incomeTotalMinor,
  expenseTotalMinor,
  netTotalMinor,
  cashWithdrawalTotalMinor,
  expenseLessOneTimeTotalMinor
}: DashboardSummaryHeroProps) {
  const periodLabel = viewMode === "year" ? `${selectedYear}` : "This month";
  const net = netTone(netTotalMinor);

  return (
    <section className="dashboard-summary-hero" aria-label={`${periodLabel} income and expense summary`}>
      <div className="dashboard-summary-hero-equation">
        <div className="dashboard-summary-hero-item dashboard-summary-hero-income">
          <div className="dashboard-summary-hero-label">
            <ArrowUp className="dashboard-summary-hero-icon" aria-hidden />
            <span>Income</span>
          </div>
          <p className="dashboard-summary-hero-value">{formatMinor(incomeTotalMinor, currencyCode)}</p>
        </div>

        <span className="dashboard-summary-hero-operator" aria-hidden>
          −
        </span>

        <div className="dashboard-summary-hero-item dashboard-summary-hero-expense">
          <div className="dashboard-summary-hero-label">
            <ArrowDown className="dashboard-summary-hero-icon" aria-hidden />
            <span>Expense</span>
          </div>
          <p className="dashboard-summary-hero-value">{formatMinor(expenseTotalMinor, currencyCode)}</p>
        </div>

        <span className="dashboard-summary-hero-operator" aria-hidden>
          =
        </span>

        <div
          className={cn(
            "dashboard-summary-hero-item dashboard-summary-hero-net",
            net === "success" && "dashboard-summary-hero-net-positive",
            net === "danger" && "dashboard-summary-hero-net-negative"
          )}
        >
          <div className="dashboard-summary-hero-label">
            {netTotalMinor > 0 ? (
              <ArrowUp className="dashboard-summary-hero-icon" aria-hidden />
            ) : netTotalMinor < 0 ? (
              <ArrowDown className="dashboard-summary-hero-icon" aria-hidden />
            ) : null}
            <span>Net</span>
          </div>
          <p className="dashboard-summary-hero-value">{formatMinor(netTotalMinor, currencyCode)}</p>
        </div>
      </div>

      <div className="dashboard-summary-hero-secondary">
        <div className="dashboard-summary-hero-item dashboard-summary-hero-secondary-item dashboard-summary-hero-core-spend">
          <div className="dashboard-summary-hero-label">
            <Minus className="dashboard-summary-hero-icon" aria-hidden />
            <span>Expense - One-Time</span>
          </div>
          <p className="dashboard-summary-hero-value">{formatMinor(expenseLessOneTimeTotalMinor, currencyCode)}</p>
        </div>

        <div className="dashboard-summary-hero-item dashboard-summary-hero-secondary-item dashboard-summary-hero-cash">
          <div className="dashboard-summary-hero-label">
            <Banknote className="dashboard-summary-hero-icon" aria-hidden />
            <span>Cash Withdrawn</span>
          </div>
          <p className="dashboard-summary-hero-value">{formatMinor(cashWithdrawalTotalMinor, currencyCode)}</p>
        </div>
      </div>
    </section>
  );
}
