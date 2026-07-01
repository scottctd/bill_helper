/**
 * CALLING SPEC:
 * - Purpose: define dashboard analytics contracts for the frontend.
 * - Inputs: frontend modules that render dashboard charts, summaries, and reconciliation views.
 * - Outputs: dashboard type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type TopTag = ApiSchemas["DashboardBreakdownItem"];
export type DashboardKpis = ApiSchemas["DashboardKpisRead"];
export type DashboardBreakdownItem = ApiSchemas["DashboardBreakdownItem"];
export type DashboardBreakdownEntryItem = ApiSchemas["DashboardBreakdownEntryItem"];
export type DashboardToBreakdownItem = ApiSchemas["DashboardToBreakdownItem"];
export type DashboardCategoryChildSummary = ApiSchemas["DashboardCategoryChildSummary"];
export type DashboardCategorySummary = ApiSchemas["DashboardCategorySummary"];
export type DashboardLifecycleSummary = ApiSchemas["DashboardLifecycleSummary"];
export type DashboardGroupSummary = ApiSchemas["DashboardGroupSummary"];
export type DashboardDailySpendingPoint = ApiSchemas["DashboardDailySpendingPoint"];
export type DashboardMonthlyTrendPoint = ApiSchemas["DashboardMonthlyTrendPoint"];
export type DashboardWeekdaySpendingPoint = ApiSchemas["DashboardWeekdaySpendingPoint"];
export type DashboardLargestExpenseItem = ApiSchemas["DashboardLargestExpenseItem"];
export type DashboardProjection = ApiSchemas["DashboardProjectionRead"];
export type DashboardTimeline = ApiSchemas["DashboardTimelineRead"];
export type Dashboard = ApiSchemas["DashboardRead"];
