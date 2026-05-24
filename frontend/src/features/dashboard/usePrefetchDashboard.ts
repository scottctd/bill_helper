/**
 * CALLING SPEC:
 * - Purpose: prefetch dashboard route assets and core queries on navigation intent.
 * - Inputs: React Query client and optional month scope for month dashboard prefetch.
 * - Outputs: prefetch helper callbacks for sidebar and dashboard controls.
 * - Side effects: lazy chunk import and React Query prefetch requests.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { getDashboard, getDashboardBatch, getDashboardTimeline } from "../../lib/api";
import { currentMonth } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";

const DASHBOARD_STALE_TIME_MS = 60_000;

export function prefetchDashboardPageChunk(): void {
  void import("../../pages/DashboardPage");
}

export function usePrefetchDashboard() {
  const queryClient = useQueryClient();

  const prefetchCoreDashboard = useCallback(
    (month: string = currentMonth()) => {
      prefetchDashboardPageChunk();
      void queryClient.prefetchQuery({
        queryKey: queryKeys.dashboard.timeline,
        queryFn: getDashboardTimeline,
        staleTime: DASHBOARD_STALE_TIME_MS
      });
      void queryClient.prefetchQuery({
        queryKey: queryKeys.dashboard.month(month),
        queryFn: () => getDashboard(month),
        staleTime: DASHBOARD_STALE_TIME_MS
      });
    },
    [queryClient]
  );

  const prefetchYearDashboard = useCallback(
    (monthKeys: string[]) => {
      if (monthKeys.length === 0) {
        return;
      }
      void queryClient.prefetchQuery({
        queryKey: queryKeys.dashboard.batch(monthKeys),
        queryFn: () => getDashboardBatch(monthKeys),
        staleTime: DASHBOARD_STALE_TIME_MS
      });
    },
    [queryClient]
  );

  return {
    prefetchCoreDashboard,
    prefetchYearDashboard
  };
}
