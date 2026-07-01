/**
 * CALLING SPEC:
 * - Purpose: log dev-visible warnings for unrecognized agent SSE event types.
 * - Inputs: parsed SSE payloads cast to AgentStreamEvent.
 * - Outputs: console.warn when type is absent from KNOWN_AGENT_STREAM_EVENT_TYPES.
 * - Side effects: console output in development builds.
 */
import { KNOWN_AGENT_STREAM_EVENT_TYPES, type AgentStreamEvent } from "../../../lib/types";

const knownTypeSet = new Set<string>(KNOWN_AGENT_STREAM_EVENT_TYPES);

export function warnUnknownAgentStreamEvent(event: AgentStreamEvent): void {
  if (knownTypeSet.has(event.type)) {
    return;
  }
  console.warn("[agent-stream] Ignoring unknown SSE event type:", event.type, event);
}
