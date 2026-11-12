import { z } from "zod";
import { Created, DisplayName, Id, Limit, Offset, Revision, type RpcSpec, SubjectId, Timestamp, Written, page } from "../common";
import { GroupName, SchoolYear, StaffRole } from "./entities";

// RPCs of groups (supabase/migrations/20261111131000_rpc_identity_groups.sql).
// Writes are T1.2a; the projections are T1.2b. No projection here carries a sensitive field.

/**
 * What a group listing shows: no student, no profile. myRole is the caller's teaching role, null
 * for an admin or an inclusion member who reads the group without teaching it.
 */
export const GroupSummary = z
  .object({
    id: Id,
    name: z.string(),
    subjectId: SubjectId,
    schoolYear: z.int(),
    archivedAt: Timestamp.nullable(),
    revision: Revision,
    myRole: StaffRole.nullable(),
    studentCount: z.int().min(0),
  })
  .strict();
export type GroupSummary = z.infer<typeof GroupSummary>;

export const GroupDetail = GroupSummary.omit({ myRole: true, studentCount: true })
  .extend({
    institutionId: Id,
    myRole: StaffRole.nullable(),
    staff: z.array(z.object({ userId: Id, displayName: DisplayName.nullable(), role: StaffRole }).strict()),
  })
  .strict();
export type GroupDetail = z.infer<typeof GroupDetail>;

const groupRevision = z.object({ p_group_id: Id, p_revision: Revision }).strict();

export const GROUP_RPCS = {
  create_group: {
    args: z
      // p_op_key: one per attempt to create, reused on a retry (T1.F3).
      .object({ p_institution_id: Id, p_name: GroupName, p_subject_id: SubjectId, p_school_year: SchoolYear, p_op_key: Id })
      .strict(),
    result: Written,
  },
  update_group: {
    args: groupRevision.extend({ p_name: GroupName, p_school_year: SchoolYear }).strict(),
    result: Written,
  },
  archive_group: { args: groupRevision, result: Written },
  restore_group: { args: groupRevision, result: Written },
  add_group_staff: {
    args: z.object({ p_group_id: Id, p_user_id: Id, p_role: StaffRole }).strict(),
    result: Created,
  },
  remove_group_staff: {
    args: z.object({ p_group_id: Id, p_user_id: Id }).strict(),
    result: Created,
  },
  list_my_groups: {
    args: z
      .object({
        p_institution_id: Id,
        p_include_archived: z.boolean().optional(),
        p_limit: Limit.optional(),
        p_offset: Offset.optional(),
      })
      .strict(),
    result: page(GroupSummary),
  },
  get_group: {
    args: z.object({ p_group_id: Id }).strict(),
    result: GroupDetail,
  },
} satisfies Record<string, RpcSpec>;
