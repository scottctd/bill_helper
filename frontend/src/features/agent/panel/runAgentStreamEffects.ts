/**
 * CALLING SPEC:
 * - Purpose: execute stream reducer side effects against React Query and hydration APIs.
 * - Inputs: QueryClient, stream effect list, and tool-call hydration callback.
 * - Outputs: none; applies cache patches and schedules fetches.
 * - Side effects: query cache updates, HTTP tool-call fetches, thread invalidation.
 */
import type { QueryClient } from "@tanstack/react-query";

import { invalidateAgentThreadData } from "../../../lib/queryInvalidation";
import { patchAgentThreadCacheFromStreamEvent, patchAgentThreadCachedRunUsage } from "../threadDetailCache";
import type { StreamEffect } from "./streamReducer";

export function runAgentStreamEffects(
  queryClient: QueryClient,
  effects: StreamEffect[],
  hydrateToolCall: (threadId: string, runId: string, toolCallId: string, force?: boolean) => void
): void {
  for (const effect of effects) {
    if (effect.type === "patch_thread_cache") {
      patchAgentThreadCacheFromStreamEvent(queryClient, effect.threadId, effect.event, {
        reasoningText: effect.reasoningText
      });
      continue;
    }
    if (effect.type === "patch_run_usage") {
      patchAgentThreadCachedRunUsage(queryClient, effect.threadId, effect.runId, effect.runUsage);
      continue;
    }
    if (effect.type === "hydrate_tool_call") {
      void hydrateToolCall(effect.threadId, effect.runId, effect.toolCallId, effect.force);
      continue;
    }
    if (effect.type === "invalidate_thread") {
      invalidateAgentThreadData(queryClient, effect.threadId);
    }
  }
}
