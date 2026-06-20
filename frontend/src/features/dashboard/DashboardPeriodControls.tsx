/**
 * CALLING SPEC:
 * - Purpose: render dashboard year and month scope selectors in the workspace toolbar.
 * - Inputs: view mode, selected month/year, timeline keys, scroll refs, and change handlers.
 * - Outputs: labeled year and month chip strips (month strip disabled in year view).
 * - Side effects: wheel on strips maps to horizontal scroll; React refs via `registerTimelineItem`.
 */

import { type KeyboardEvent, type MutableRefObject } from "react";

import { cn } from "../../lib/utils";
import { DashboardScrollStrip } from "./DashboardScrollStrip";
import {
  type DashboardViewMode,
  buildYearMonthKeys,
  formatMonthLong,
  formatMonthShort,
  pickTimelineMonthForYear
} from "./helpers";

export const TIMELINE_ITEM_KEY = {
  year: (yearKey: string) => `year:${yearKey}`,
  month: (monthKey: string) => `month:${monthKey}`
} as const;

type DashboardPeriodControlsProps = {
  viewMode: DashboardViewMode;
  month: string;
  selectedYear: number;
  timelineMonths: string[];
  timelineYears: string[];
  yearScrollRef: MutableRefObject<HTMLDivElement | null>;
  monthScrollRef: MutableRefObject<HTMLDivElement | null>;
  registerTimelineItem: (key: string, node: HTMLButtonElement | null) => void;
  setTimelineMonth: (nextMonth: string, behavior?: ScrollBehavior) => void;
  onYearKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMonthKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export function DashboardPeriodControls({
  viewMode,
  month,
  selectedYear,
  timelineMonths,
  timelineYears,
  yearScrollRef,
  monthScrollRef,
  registerTimelineItem,
  setTimelineMonth,
  onYearKeyDown,
  onMonthKeyDown
}: DashboardPeriodControlsProps) {
  const monthView = viewMode === "month";
  const calendarMonthKeys = buildYearMonthKeys(selectedYear);
  const timelineMonthSet = new Set(timelineMonths);
  const hasTimelineYears = timelineYears.length > 0;

  return (
    <>
      <div className="field dashboard-toolbar-year dashboard-timeline-strip-field">
        <span className="text-label-12 font-medium text-muted-foreground">Year</span>
        <DashboardScrollStrip
          ariaLabel="Year timeline"
          scrollRef={yearScrollRef}
          onKeyDown={onYearKeyDown}
          empty={!hasTimelineYears}
          emptyMessage="No expense years yet."
        >
          {timelineYears.map((yearKey) => {
            const isActive = yearKey === String(selectedYear);
            return (
              <button
                key={yearKey}
                ref={(node) => registerTimelineItem(TIMELINE_ITEM_KEY.year(yearKey), node)}
                type="button"
                className={cn(
                  "dashboard-month-chip-toolbar inline-flex items-center",
                  isActive && "dashboard-month-chip-toolbar-active"
                )}
                onClick={() => {
                  const nextMonth = pickTimelineMonthForYear(timelineMonths, yearKey, month);
                  if (nextMonth) {
                    setTimelineMonth(nextMonth);
                  }
                }}
                aria-label={`${yearKey} overview`}
                aria-pressed={isActive}
              >
                <span className="dashboard-month-chip-toolbar-label">{yearKey}</span>
              </button>
            );
          })}
        </DashboardScrollStrip>
      </div>

      <div className="field dashboard-toolbar-month dashboard-timeline-strip-field min-w-0">
        <span className="text-label-12 font-medium text-muted-foreground">Month</span>
        <DashboardScrollStrip
          ariaLabel="Month timeline"
          scrollRef={monthScrollRef}
          onKeyDown={onMonthKeyDown}
          disabled={!monthView}
          empty={!hasTimelineYears}
          emptyMessage={monthView ? "No dashboard months yet." : "Switch to month view to pick a month."}
        >
          {calendarMonthKeys.map((monthKey) => {
            const hasData = timelineMonthSet.has(monthKey);
            const isActive = monthView && monthKey === month;
            return (
              <button
                key={monthKey}
                ref={(node) => registerTimelineItem(TIMELINE_ITEM_KEY.month(monthKey), node)}
                type="button"
                className={cn(
                  "dashboard-month-chip-toolbar inline-flex items-center",
                  isActive && "dashboard-month-chip-toolbar-active",
                  !hasData && "dashboard-month-chip-toolbar-unavailable"
                )}
                disabled={!monthView || !hasData}
                onClick={() => {
                  if (monthView && hasData) {
                    setTimelineMonth(monthKey);
                  }
                }}
                aria-label={formatMonthLong(monthKey)}
                aria-pressed={isActive}
              >
                <span className="dashboard-month-chip-toolbar-label">{formatMonthShort(monthKey)}</span>
              </button>
            );
          })}
        </DashboardScrollStrip>
      </div>
    </>
  );
}
