/**
 * CALLING SPEC:
 * - Purpose: provide the `domains` frontend module.
 * - Inputs: callers that import `frontend/src/features/agent/review/diff/domains.ts` and pass module-defined arguments or framework events.
 * - Outputs: typed helpers, contracts, or exports from `domains`.
 * - Side effects: module-local frontend behavior only.
 */
import type { DiffMetadata, JsonRecord, ProposalDiff } from "./types";
import { asRecord, buildRecordUpdateDiff, jsonRecordsAreEquivalent } from "./core";

export function previewName(preview: JsonRecord, fallback: string): string {
  const name = preview.name;
  return typeof name === "string" && name.trim() ? name : fallback;
}

export function previewSource(preview: JsonRecord): string {
  const source = preview.group_source ?? preview.source;
  return typeof source === "string" && source.trim() ? source : "manual";
}

export function buildGroupRecord(payload: JsonRecord): JsonRecord {
  return {
    name: typeof payload.name === "string" ? payload.name : "",
    source: typeof payload.source === "string" ? payload.source : previewSource(payload)
  };
}

export function buildAccountRecord(payload: JsonRecord): JsonRecord {
  return {
    name: typeof payload.name === "string" ? payload.name : "",
    currency_code: typeof payload.currency_code === "string" ? payload.currency_code : "",
    is_active: typeof payload.is_active === "boolean" ? payload.is_active : true,
    markdown_body:
      typeof payload.markdown_body === "string" || payload.markdown_body === null ? payload.markdown_body : null
  };
}

export function buildUpdateAccountBeforeRecord(payload: JsonRecord): JsonRecord {
  const current = asRecord(payload.current);
  return buildAccountRecord({
    name: typeof current.name === "string" ? current.name : payload.name,
    currency_code: current.currency_code,
    is_active: current.is_active,
    markdown_body: Object.prototype.hasOwnProperty.call(current, "markdown_body") ? current.markdown_body : null
  });
}

export function buildUpdateAccountAfterRecord(
  payload: JsonRecord,
  reviewerOverride?: JsonRecord
): { before: JsonRecord; after: JsonRecord; reviewerEdited: boolean } {
  const before = buildUpdateAccountBeforeRecord(payload);
  const reviewerEdited = Boolean(reviewerOverride && !jsonRecordsAreEquivalent(payload, reviewerOverride));
  const effectivePatch = reviewerEdited ? asRecord(reviewerOverride?.patch) : asRecord(payload.patch);
  return {
    before,
    after: buildAccountRecord({
      ...before,
      ...(typeof effectivePatch.name === "string" ? { name: effectivePatch.name } : {}),
      ...(typeof effectivePatch.currency_code === "string" ? { currency_code: effectivePatch.currency_code } : {}),
      ...(typeof effectivePatch.is_active === "boolean" ? { is_active: effectivePatch.is_active } : {}),
      ...(Object.prototype.hasOwnProperty.call(effectivePatch, "markdown_body")
        ? { markdown_body: effectivePatch.markdown_body }
        : {})
    }),
    reviewerEdited
  };
}

export function buildUpdateGroupBeforeRecord(payload: JsonRecord): JsonRecord {
  const current = asRecord(payload.current);
  const target = asRecord(payload.target);
  return {
    name: typeof current.name === "string" ? current.name : typeof target.name === "string" ? target.name : "",
    source: typeof current.group_source === "string"
      ? current.group_source
      : typeof target.group_source === "string"
        ? target.group_source
        : previewSource(current.name ? current : target)
  };
}

export function buildUpdateGroupAfterRecord(
  payload: JsonRecord,
  reviewerOverride?: JsonRecord
): { before: JsonRecord; after: JsonRecord; reviewerEdited: boolean } {
  const before = buildUpdateGroupBeforeRecord(payload);
  const reviewerEdited = Boolean(reviewerOverride && !jsonRecordsAreEquivalent(payload, reviewerOverride));
  const effectivePatch = reviewerEdited ? asRecord(reviewerOverride?.patch) : asRecord(payload.patch);
  return {
    before,
    after: {
      ...before,
      ...(typeof effectivePatch.name === "string" ? { name: effectivePatch.name } : {}),
      ...(typeof effectivePatch.description === "string" ? { description: effectivePatch.description } : {}),
      ...(typeof effectivePatch.color === "string" ? { color: effectivePatch.color } : {}),
      ...(Object.prototype.hasOwnProperty.call(effectivePatch, "rule") ? { rule: effectivePatch.rule } : {})
    },
    reviewerEdited
  };
}

function buildEntryRecordFromMemberPreview(memberPreview: JsonRecord): JsonRecord {
  const record: JsonRecord = {};
  if (typeof memberPreview.date === "string" && memberPreview.date.trim()) {
    record.date = memberPreview.date;
  }
  if (typeof memberPreview.name === "string" && memberPreview.name.trim()) {
    record.name = memberPreview.name;
  }
  if (typeof memberPreview.kind === "string" && memberPreview.kind.trim()) {
    record.kind = memberPreview.kind;
  }
  if (typeof memberPreview.amount_minor === "number") {
    record.amount_minor = memberPreview.amount_minor;
  }
  if (typeof memberPreview.currency_code === "string" && memberPreview.currency_code.trim()) {
    record.currency_code = memberPreview.currency_code;
  }
  if (typeof memberPreview.from_entity === "string" && memberPreview.from_entity.trim()) {
    record.from_entity = memberPreview.from_entity;
  }
  if (typeof memberPreview.to_entity === "string" && memberPreview.to_entity.trim()) {
    record.to_entity = memberPreview.to_entity;
  }
  if (Array.isArray(memberPreview.tags)) {
    record.tags = memberPreview.tags;
  }
  if (typeof memberPreview.markdown_notes === "string" && memberPreview.markdown_notes.trim()) {
    record.markdown_notes = memberPreview.markdown_notes;
  }
  return record;
}

function membershipOverride(payload: JsonRecord): string | null {
  const target = asRecord(payload.target);
  const override = target.override;
  return typeof override === "string" && override.trim() ? override : null;
}

function decorateGroupMembershipRecord(
  subjectRecord: JsonRecord,
  options: {
    groupName: string;
    override: string | null;
    includeMembership: boolean;
  }
): JsonRecord {
  const { groupName, override, includeMembership } = options;
  if (!includeMembership) {
    return { ...subjectRecord };
  }
  return {
    ...subjectRecord,
    group: groupName,
    ...(override ? { override } : {})
  };
}

export function buildGroupMembershipDiff(
  payload: JsonRecord,
  metadata: DiffMetadata[],
  action: "add" | "remove",
  reviewerOverride?: JsonRecord
): ProposalDiff {
  const reviewerEdited = Boolean(reviewerOverride && !jsonRecordsAreEquivalent(payload, reviewerOverride));
  const effectivePayload = reviewerEdited
    ? {
        ...payload,
        ...reviewerOverride,
        group_preview: reviewerOverride?.group_preview ?? payload.group_preview,
        member_preview: reviewerOverride?.member_preview ?? payload.member_preview
      }
    : payload;
  const memberPreview = asRecord(payload.member_preview);
  const subjectRecord = buildEntryRecordFromMemberPreview(memberPreview);
  const parentGroup = asRecord(effectivePayload.group_preview);
  const groupName = previewName(parentGroup, "Unknown group");
  const override = membershipOverride(effectivePayload);
  const before = decorateGroupMembershipRecord(subjectRecord, {
    groupName,
    override,
    includeMembership: action === "remove"
  });
  const after = decorateGroupMembershipRecord(subjectRecord, {
    groupName,
    override,
    includeMembership: action === "add"
  });
  return buildRecordUpdateDiff(before, after, metadata, { reviewerEdited });
}
