/**
 * CALLING SPEC:
 * - Purpose: expose group and group-membership API calls for the frontend.
 * - Inputs: group ids, membership ids, and group mutation payloads.
 * - Outputs: group-domain read models or empty success responses.
 * - Side effects: HTTP requests only.
 */

import type { GroupMemberCreatePayload, GroupRead, GroupRule, GroupSource, GroupSummary } from "../types";
import { request } from "./core";

export function createGroup(payload: {
  name: string;
  source?: GroupSource;
  description?: string | null;
  color?: string | null;
  rule?: GroupRule | null;
}): Promise<GroupRead> {
  return request<GroupRead>("/api/v1/groups", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getGroup(groupId: string): Promise<GroupRead> {
  return request<GroupRead>(`/api/v1/groups/${groupId}`);
}

export function listGroups(): Promise<GroupSummary[]> {
  return request<GroupSummary[]>("/api/v1/groups");
}

export function updateGroup(
  groupId: string,
  payload: {
    name?: string;
    description?: string | null;
    color?: string | null;
    rule?: GroupRule | null;
  }
): Promise<GroupRead> {
  return request<GroupRead>(`/api/v1/groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteGroup(groupId: string): Promise<void> {
  return request<void>(`/api/v1/groups/${groupId}`, {
    method: "DELETE"
  });
}

export function addGroupMember(groupId: string, payload: GroupMemberCreatePayload): Promise<GroupRead> {
  return request<GroupRead>(`/api/v1/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteGroupMember(groupId: string, membershipId: string): Promise<void> {
  return request<void>(`/api/v1/groups/${groupId}/members/${membershipId}`, {
    method: "DELETE"
  });
}
