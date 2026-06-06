/**
 * CALLING SPEC:
 * - Purpose: extract entry TOC grouping fields from proposal payloads.
 * - Inputs: entry change types and payload_json records.
 * - Outputs: entry name and destination entity for sidebar tree grouping.
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";

const ENTRY_CHANGE_TYPES = new Set<AgentChangeType>(["create_entry", "update_entry", "delete_entry"]);

export interface EntryTocFields {
  entryName: string;
  entryToEntity: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function isEntryChangeType(changeType: string): changeType is AgentChangeType {
  return ENTRY_CHANGE_TYPES.has(changeType as AgentChangeType);
}

export function extractEntryTocFields(changeType: string, payload: Record<string, unknown>): EntryTocFields | null {
  if (!isEntryChangeType(changeType)) {
    return null;
  }

  switch (changeType) {
    case "create_entry":
      return {
        entryName: asText(payload.name, "Untitled"),
        entryToEntity: asText(payload.to_entity, "Unknown destination")
      };
    case "update_entry": {
      const target = asRecord(payload.target);
      const patch = asRecord(payload.patch);
      return {
        entryName: asText(patch.name ?? target.name, "Untitled"),
        entryToEntity: asText(patch.to_entity ?? target.to_entity, "Unknown destination")
      };
    }
    case "delete_entry": {
      const target = asRecord(payload.target);
      const selector = asRecord(payload.selector);
      return {
        entryName: asText(selector.name ?? target.name, "Untitled"),
        entryToEntity: asText(target.to_entity, "Unknown destination")
      };
    }
    default:
      return null;
  }
}
