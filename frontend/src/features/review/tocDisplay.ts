/**
 * CALLING SPEC:
 * - Purpose: build unified TOC leaf titles and subtitles for review proposals.
 * - Inputs: change type, payload_json, and optional import source labels.
 * - Outputs: display strings for sidebar proposal buttons.
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import { formatMinor } from "../../lib/format";
import { changeTypeLabel } from "../agent/review/model";
import { extractEntryTocFields, isEntryChangeType } from "./entryTocFields";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatEntryKindSign(kind: string): string | null {
  switch (kind.trim().toUpperCase()) {
    case "EXPENSE":
      return "-";
    case "INCOME":
      return "+";
    case "TRANSFER":
      return "~";
    default:
      return null;
  }
}

function extractEntryKind(changeType: string, payload: Record<string, unknown>): string | null {
  if (!isEntryChangeType(changeType)) {
    return null;
  }

  switch (changeType) {
    case "create_entry":
      return asText(payload.kind) || null;
    case "update_entry": {
      const target = asRecord(payload.target);
      const patch = asRecord(payload.patch);
      return asText(patch.kind ?? target.kind) || null;
    }
    case "delete_entry": {
      const target = asRecord(payload.target);
      return asText(target.kind) || null;
    }
    default:
      return null;
  }
}

function extractEntryAmountMeta(changeType: string, payload: Record<string, unknown>): string | null {
  if (!isEntryChangeType(changeType)) {
    return null;
  }

  let date = "";
  let amountMinor: number | null = null;
  let currencyCode = "USD";

  switch (changeType) {
    case "create_entry":
      date = asText(payload.date);
      amountMinor = typeof payload.amount_minor === "number" ? payload.amount_minor : null;
      currencyCode = asText(payload.currency_code, "USD");
      break;
    case "update_entry": {
      const target = asRecord(payload.target);
      const patch = asRecord(payload.patch);
      date = asText(patch.date ?? target.date);
      amountMinor =
        typeof patch.amount_minor === "number"
          ? patch.amount_minor
          : typeof target.amount_minor === "number"
            ? target.amount_minor
            : null;
      currencyCode = asText(patch.currency_code ?? target.currency_code, "USD");
      break;
    }
    case "delete_entry": {
      const target = asRecord(payload.target);
      date = asText(target.date);
      amountMinor = typeof target.amount_minor === "number" ? target.amount_minor : null;
      currencyCode = asText(target.currency_code, "USD");
      break;
    }
    default:
      return null;
  }

  const kindSign = formatEntryKindSign(extractEntryKind(changeType, payload) ?? "");
  const amountText = amountMinor != null ? formatMinor(amountMinor, currencyCode) : null;
  const signedAmount =
    amountText != null
      ? kindSign
        ? `${kindSign} ${amountText}`
        : amountText
      : kindSign || null;

  const parts: string[] = [];
  if (date) {
    parts.push(date);
  }
  if (signedAmount) {
    parts.push(signedAmount);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function extractProposalName(changeType: AgentChangeType, payload: Record<string, unknown>): string {
  const selector = asRecord(payload.selector);
  const target = asRecord(payload.target);
  const current = asRecord(payload.current);
  const patch = asRecord(payload.patch);
  const groupPreview = asRecord(payload.group_preview);
  const memberPreview = asRecord(payload.member_preview);

  switch (changeType) {
    case "create_entry":
    case "create_tag":
    case "create_entity":
    case "create_account":
    case "create_group":
      return asText(payload.name, "Untitled");
    case "update_entry":
      return asText(patch.name ?? target.name, "Untitled");
    case "update_tag":
      return asText(payload.name ?? patch.name ?? target.name, "Untitled");
    case "update_entity":
    case "update_account":
      return asText(payload.name ?? current.name, "Untitled");
    case "update_group":
      return asText(current.name ?? target.name, "Untitled");
    case "delete_entry":
    case "delete_tag":
      return asText(selector.name ?? target.name ?? payload.name, "Untitled");
    case "delete_entity":
    case "delete_account":
    case "delete_group":
      return asText(payload.name ?? target.name, "Untitled");
    case "create_snapshot":
      return asText(payload.account_name, "Untitled");
    case "delete_snapshot":
      return asText(payload.account_name, "Untitled");
    case "create_group_member":
    case "delete_group_member":
      return asText(memberPreview.name, "Member");
    default:
      return changeTypeLabel(changeType);
  }
}

function buildEntryTocTitle(changeType: string, payload: Record<string, unknown>): string {
  const entryFields = extractEntryTocFields(changeType, payload);
  return entryFields?.entryName ?? "Untitled";
}

export function buildTocLeafTitle(changeType: string, payload: Record<string, unknown>): string {
  if (isEntryChangeType(changeType)) {
    return buildEntryTocTitle(changeType, payload);
  }
  return extractProposalName(changeType as AgentChangeType, payload);
}

export function buildTocLeafMeta(changeType: string, payload: Record<string, unknown>): string | undefined {
  const typedChangeType = changeType as AgentChangeType;

  if (isEntryChangeType(typedChangeType)) {
    return extractEntryAmountMeta(typedChangeType, payload) ?? undefined;
  }

  const target = asRecord(payload.target);
  const current = asRecord(payload.current);
  const groupPreview = asRecord(payload.group_preview);

  switch (typedChangeType) {
    case "create_entity":
    case "update_entity":
    case "delete_entity":
      return asText(payload.category) || undefined;
    case "create_account":
    case "update_account":
    case "delete_account":
      return asText(payload.currency_code ?? current.currency_code) || undefined;
    case "create_tag":
    case "update_tag":
    case "delete_tag":
      return asText(payload.type ?? target.type) || undefined;
    case "create_group":
    case "update_group":
    case "delete_group":
      return asText(payload.group_type ?? current.group_type ?? target.group_type) || undefined;
    case "create_snapshot":
      return asText(payload.snapshot_at) || undefined;
    case "delete_snapshot":
      return asText(asRecord(payload.target).snapshot_at) || undefined;
    case "create_group_member":
    case "delete_group_member":
      return asText(groupPreview.name) || undefined;
    default:
      return undefined;
  }
}
