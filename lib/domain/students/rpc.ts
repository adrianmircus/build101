import { z } from "zod";
import { Created, DisplayName, Id, Limit, Offset, Revision, type RpcSpec, Timestamp, Written, page } from "../common";
import { Username } from "./entities";

// RPCs of students and enrollments (20261111131000_rpc_identity_groups.sql), owner T1.2b.
// The listing is a projection without needs: names are personal, not sensitive, and staff of the
// group may see them.

export const GroupStudent = z
  .object({
    id: Id,
    displayName: DisplayName,
    username: Username,
    archivedAt: Timestamp.nullable(),
    enrolledAt: Timestamp,
    hasAccount: z.boolean(),
    revision: Revision,
  })
  .strict();
export type GroupStudent = z.infer<typeof GroupStudent>;

const studentRevision = z.object({ p_student_id: Id, p_revision: Revision }).strict();
const membership = z.object({ p_group_id: Id, p_student_id: Id }).strict();

export const STUDENT_RPCS = {
  /** service_role: links a student to its Auth account (T2.5 runs it; factories use it). */
  internal_link_student_user: {
    args: z.object({ p_student_id: Id, p_user_id: Id }).strict(),
    result: Created,
  },
  create_student: {
    args: z
      .object({ p_group_id: Id, p_display_name: DisplayName, p_username: Username, p_op_key: Id })
      .strict(),
    // provisioningId is null in a sandbox: no real account is ever created there.
    result: z.object({ id: Id, revision: Revision, provisioningId: Id.nullable() }).strict(),
  },
  update_student: {
    args: studentRevision.extend({ p_display_name: DisplayName, p_username: Username }).strict(),
    result: Written,
  },
  archive_student: { args: studentRevision, result: Written },
  restore_student: { args: studentRevision, result: Written },
  enroll_student: { args: membership, result: Created },
  unenroll_student: { args: membership, result: Created },
  list_group_students: {
    args: z
      .object({
        p_group_id: Id,
        p_include_archived: z.boolean().optional(),
        p_limit: Limit.optional(),
        p_offset: Offset.optional(),
      })
      .strict(),
    result: page(GroupStudent),
  },
} satisfies Record<string, RpcSpec>;
