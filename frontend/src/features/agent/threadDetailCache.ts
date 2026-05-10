/**
 * CALLING SPEC:
 * - Purpose: patch cached `AgentThreadDetail` in React Query from incremental SSE data.
 * - Inputs: `QueryClient`, thread id, run id, and payloads emitted by the agent stream.
 * - Outputs: `patchAgentThreadCachedRunUsage` helper.
 * - Side effects: updates thread detail query data in place when a matching run exists.
 */
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";
import type { AgentRun, AgentStreamRunUsage, AgentThreadDetail } from "../../lib/types";
import { recomputeThreadCurrentContextTokens } from "./activity";

const RUN_USAGE_PATCH_FIELDS: (keyof AgentStreamRunUsage)[] = [
  "context_tokens",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "input_cost_usd",
  "output_cost_usd",
  "total_cost_usd"
];

export function patchAgentThreadCachedRunUsage(
  queryClient: QueryClient,
  threadId: string,
  runId: string,
  runUsage: AgentStreamRunUsage
): void {
  queryClient.setQueryData(queryKeys.agent.thread(threadId), (current: AgentThreadDetail | undefined) => {
    if (!current) {
      return current;
    }
    let mutated = false;
    const runs = current.runs.map((run) => {
      if (run.id !== runId) {
        return run;
      }
      let next: AgentRun = run;
      for (const key of RUN_USAGE_PATCH_FIELDS) {
        const value = runUsage[key];
        if (value != null) {
          if (next === run) {
            next = { ...run };
            mutated = true;
          }
          (next as AgentRun)[key] = value;
        }
      }
      return next;
    });
    if (!mutated) {
      return current;
    }
    const nextContext = recomputeThreadCurrentContextTokens(runs);
    return {
      ...current,
      runs,
      current_context_tokens: nextContext ?? current.current_context_tokens
    };
  });
}
