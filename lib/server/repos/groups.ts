import "server-only";
import type { Written } from "@/lib/domain/common";
import type { StaffRole } from "@/lib/domain/groups/entities";
import type { GroupDetail, GroupSummary } from "@/lib/domain/groups/rpc";
import { callRpc, type RpcDb } from "./rpc";

// Groups as the logged-in person sees them. The database applies who may read or change what:
// a repo only translates names and types.

export type Page<T> = { items: T[]; total: number };

export type NewGroup = { institutionId: string; name: string; subjectId: string; schoolYear: number };

/** The creator becomes the owner of the group. */
export async function createGroup(db: RpcDb, input: NewGroup): Promise<Written> {
  return callRpc(db, "create_group", {
    p_institution_id: input.institutionId,
    p_name: input.name,
    p_subject_id: input.subjectId,
    p_school_year: input.schoolYear,
  });
}

export type GroupChanges = { revision: number; name: string; schoolYear: number };

/** `revision` is the one the caller read: a stale one is CONFLICT. */
export async function updateGroup(db: RpcDb, groupId: string, changes: GroupChanges): Promise<Written> {
  return callRpc(db, "update_group", {
    p_group_id: groupId,
    p_revision: changes.revision,
    p_name: changes.name,
    p_school_year: changes.schoolYear,
  });
}

export async function archiveGroup(db: RpcDb, groupId: string, revision: number): Promise<Written> {
  return callRpc(db, "archive_group", { p_group_id: groupId, p_revision: revision });
}

export async function restoreGroup(db: RpcDb, groupId: string, revision: number): Promise<Written> {
  return callRpc(db, "restore_group", { p_group_id: groupId, p_revision: revision });
}

export type NewStaff = { userId: string; role: StaffRole };

export async function addGroupStaff(db: RpcDb, groupId: string, member: NewStaff): Promise<{ id: string }> {
  return callRpc(db, "add_group_staff", { p_group_id: groupId, p_user_id: member.userId, p_role: member.role });
}

export async function removeGroupStaff(db: RpcDb, groupId: string, userId: string): Promise<{ id: string }> {
  return callRpc(db, "remove_group_staff", { p_group_id: groupId, p_user_id: userId });
}

export type GroupListOptions = { includeArchived?: boolean; limit?: number; offset?: number };

export async function listMyGroups(
  db: RpcDb,
  institutionId: string,
  options: GroupListOptions = {},
): Promise<Page<GroupSummary>> {
  return callRpc(db, "list_my_groups", {
    p_institution_id: institutionId,
    p_include_archived: options.includeArchived,
    p_limit: options.limit,
    p_offset: options.offset,
  });
}

export async function getGroup(db: RpcDb, groupId: string): Promise<GroupDetail> {
  return callRpc(db, "get_group", { p_group_id: groupId });
}
