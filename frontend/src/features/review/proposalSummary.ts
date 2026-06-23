/**
 * CALLING SPEC:
 * - Purpose: build one-sentence natural-language summaries for proposal review cards.
 * - Inputs: change type, payload_json, and optional humanized proposal fields.
 * - Outputs: summary parts with highlighted key values (date, amount, entities, names).
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import { formatMinor } from "../../lib/format";
import type { ProposalFields } from "./proposalFields";
import type { ReviewSummaryPart } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function plain(text: string): ReviewSummaryPart {
  return { text, tone: "plain" };
}

function highlight(text: string): ReviewSummaryPart {
  return { text, tone: "highlight" };
}

export function reviewSummaryText(parts: ReviewSummaryPart[]): string {
  return parts.map((part) => part.text).join("");
}

function titleCaseKind(kind: string): string {
  const trimmed = kind.trim();
  if (!trimmed) {
    return "Entry";
  }
  return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
}

function formatAmountMinor(amountMinor: number | null | undefined, currencyCode: string): string | null {
  if (amountMinor == null || !Number.isFinite(amountMinor)) {
    return null;
  }
  return formatMinor(amountMinor, currencyCode || "USD");
}

function formatTags(tags: unknown): string | null {
  if (!Array.isArray(tags) || tags.length === 0) {
    return null;
  }
  const names = tags.map((tag) => asText(tag)).filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

function summarizeFieldChangeParts(fields: ProposalFields): ReviewSummaryPart[] | null {
  if (fields.mode !== "update" || fields.rows.length === 0) {
    return null;
  }

  const parts: ReviewSummaryPart[] = [];
  fields.rows.forEach((row, index) => {
    if (index > 0) {
      parts.push(plain(", "));
    }
    parts.push(plain(`${row.label.toLowerCase()} `));
    if (row.before && row.after && row.before !== row.after) {
      parts.push(plain(row.before), plain(" → "), highlight(row.after));
      return;
    }
    if (row.after) {
      parts.push(highlight(row.after));
    }
  });

  return parts.length > 0 ? parts : null;
}

function buildCreateEntrySummary(payload: Record<string, unknown>): ReviewSummaryPart[] {
  const date = asText(payload.date, "unknown date");
  const fromEntity = asText(payload.from_entity, "unknown source");
  const toEntity = asText(payload.to_entity, "unknown destination");
  const amount = formatAmountMinor(
    typeof payload.amount_minor === "number" ? payload.amount_minor : null,
    asText(payload.currency_code, "USD")
  );
  const name = asText(payload.name);
  const tags = formatTags(payload.tags);

  const parts: ReviewSummaryPart[] = [
    plain(`${titleCaseKind(asText(payload.kind, "entry"))} on `),
    highlight(date),
    plain(" from "),
    highlight(fromEntity),
    plain(" to "),
    highlight(toEntity)
  ];

  if (amount) {
    parts.push(plain(" for "), highlight(amount));
  }
  if (name) {
    parts.push(plain(" (“"), highlight(name), plain("”)"));
  }
  if (tags) {
    parts.push(plain(" Tags: "), highlight(tags));
  }
  const category = asText(payload.category);
  const lifecycle = asText(payload.lifecycle);
  if (category) {
    parts.push(plain(" Category: "), highlight(category));
  }
  if (lifecycle) {
    parts.push(plain(" Lifecycle: "), highlight(lifecycle));
  }
  parts.push(plain("."));
  return parts;
}

function buildEntrySelectorSummary(payload: Record<string, unknown>, verb: "Update" | "Delete"): ReviewSummaryPart[] {
  const selector = asRecord(payload.selector);
  const target = asRecord(payload.target);
  const name = asText(selector.name ?? target.name, "this entry");
  const date = asText(selector.date ?? target.date);
  const amount = formatAmountMinor(
    typeof selector.amount_minor === "number"
      ? selector.amount_minor
      : typeof target.amount_minor === "number"
        ? target.amount_minor
        : null,
    asText(selector.currency_code ?? target.currency_code, "USD")
  );

  const parts: ReviewSummaryPart[] = [plain(`${verb} entry “`), highlight(name), plain("”")];
  if (date) {
    parts.push(plain(" on "), highlight(date));
  }
  if (amount) {
    parts.push(plain(" ("), highlight(amount), plain(")"));
  }
  parts.push(plain("."));
  return parts;
}

function buildNamedResourceSummary(
  verb: string,
  resourceLabel: string,
  name: string,
  detail?: string | null
): ReviewSummaryPart[] {
  const parts: ReviewSummaryPart[] = [
    plain(`${verb} ${resourceLabel} “`),
    highlight(name),
    plain("”")
  ];
  if (detail) {
    parts.push(plain(" ("), highlight(detail), plain(")"));
  }
  parts.push(plain("."));
  return parts;
}

export function buildProposalSummary(
  changeType: AgentChangeType,
  payload: Record<string, unknown>,
  fields: ProposalFields | null = null
): ReviewSummaryPart[] {
  const target = asRecord(payload.target);
  const current = asRecord(payload.current);
  const groupPreview = asRecord(payload.group_preview);
  const memberPreview = asRecord(payload.member_preview);
  const fieldChangeParts = fields ? summarizeFieldChangeParts(fields) : null;

  switch (changeType) {
    case "create_entry":
      return buildCreateEntrySummary(payload);
    case "update_entry": {
      const parts = buildEntrySelectorSummary(payload, "Update");
      if (fieldChangeParts) {
        return [...parts.slice(0, -1), plain(" — "), ...fieldChangeParts, plain(".")];
      }
      return parts;
    }
    case "delete_entry":
      return buildEntrySelectorSummary(payload, "Delete");
    case "create_entity":
      return buildNamedResourceSummary("Create", asText(payload.category, "entity"), asText(payload.name, "Untitled"));
    case "update_entity": {
      const name = asText(payload.name ?? current.name, "Untitled");
      if (fieldChangeParts) {
        return [plain("Update entity “"), highlight(name), plain("” — "), ...fieldChangeParts, plain(".")];
      }
      return buildNamedResourceSummary("Update", "entity", name);
    }
    case "delete_entity":
      return buildNamedResourceSummary("Delete", "entity", asText(payload.name ?? target.name, "Untitled"));
    case "create_tag":
      return buildNamedResourceSummary("Create", "tag", asText(payload.name, "Untitled"), asText(payload.type) || null);
    case "update_tag": {
      const name = asText(payload.name ?? target.name, "Untitled");
      if (fieldChangeParts) {
        return [plain("Update tag “"), highlight(name), plain("” — "), ...fieldChangeParts, plain(".")];
      }
      return buildNamedResourceSummary("Update", "tag", name);
    }
    case "delete_tag":
      return buildNamedResourceSummary("Delete", "tag", asText(payload.name ?? target.name, "Untitled"));
    case "create_account":
      return buildNamedResourceSummary(
        "Create",
        "account",
        asText(payload.name, "Untitled"),
        asText(payload.currency_code) || null
      );
    case "update_account": {
      const name = asText(payload.name ?? current.name, "Untitled");
      if (fieldChangeParts) {
        return [plain("Update account “"), highlight(name), plain("” — "), ...fieldChangeParts, plain(".")];
      }
      return buildNamedResourceSummary("Update", "account", name);
    }
    case "delete_account":
      return buildNamedResourceSummary("Delete", "account", asText(payload.name ?? target.name, "Untitled"));
    case "create_snapshot": {
      const accountName = asText(payload.account_name, "account");
      const date = asText(payload.snapshot_at, "unknown date");
      const balance = formatAmountMinor(
        typeof payload.balance_minor === "number" ? payload.balance_minor : null,
        asText(payload.currency_code, "USD")
      );
      const parts: ReviewSummaryPart[] = [plain("Record "), highlight(accountName), plain(" balance")];
      if (balance) {
        parts.push(plain(" of "), highlight(balance));
      }
      parts.push(plain(" on "), highlight(date), plain("."));
      return parts;
    }
    case "delete_snapshot": {
      const accountName = asText(payload.account_name, "account");
      const date = asText(target.snapshot_at, "unknown date");
      const balance = formatAmountMinor(
        typeof target.balance_minor === "number" ? target.balance_minor : null,
        asText(payload.currency_code, "USD")
      );
      const parts: ReviewSummaryPart[] = [
        plain("Delete "),
        highlight(accountName),
        plain(" snapshot on "),
        highlight(date)
      ];
      if (balance) {
        parts.push(plain(" ("), highlight(balance), plain(")"));
      }
      parts.push(plain("."));
      return parts;
    }
    case "create_group":
      return buildNamedResourceSummary(
        "Create",
        asText(payload.source, "manual").toLowerCase(),
        asText(payload.name, "Untitled")
      );
    case "update_group": {
      const name = asText(current.name ?? target.name, "Untitled");
      if (fieldChangeParts) {
        return [plain("Update group “"), highlight(name), plain("” — "), ...fieldChangeParts, plain(".")];
      }
      return buildNamedResourceSummary("Update", "group", name);
    }
    case "delete_group":
      return buildNamedResourceSummary("Delete", "group", asText(payload.name ?? target.name, "Untitled"));
    case "create_group_member": {
      const groupName = asText(groupPreview.name, "group");
      const memberName = asText(memberPreview.name, "member");
      const target = asRecord(payload.target);
      const override = asText(target.override);
      const parts: ReviewSummaryPart[] = [
        plain("Add “"),
        highlight(memberName),
        plain("” to group “"),
        highlight(groupName),
        plain("”")
      ];
      if (override) {
        parts.push(plain(" with "), highlight(override), plain(" override"));
      }
      parts.push(plain("."));
      return parts;
    }
    case "delete_group_member": {
      const groupName = asText(groupPreview.name, "group");
      const memberName = asText(memberPreview.name, "member");
      return [
        plain("Remove “"),
        highlight(memberName),
        plain("” from group “"),
        highlight(groupName),
        plain("”.")
      ];
    }
    default:
      if (fieldChangeParts) {
        return [plain("Update proposal — "), ...fieldChangeParts, plain(".")];
      }
      return [plain("Review this proposal.")];
  }
}
