import "server-only";
import type { Written } from "@/lib/domain/common";
import type { GroupStudent } from "@/lib/domain/students/rpc";
import type { Page } from "./groups";
import { callRpc, type RpcDb } from "./rpc";

// Students and enrollments as the logged-in person sees them. The database decides who may read or
// change what (admin or staff of the group): a repo only translates names and types.

export type NewStudent = {
  displayName: string;
  username: string;
  /** One per attempt, kept on a retry: the same key with the same data answers the same student. */
  opKey: string;
};

/** Creates the student and enrolls them in the group. `provisioningId` is null in a sandbox. */
export async function createStudent(
  db: RpcDb,
  groupId: string,
  input: NewStudent,
): Promise<Written & { provisioningId: string | null }> {
  return callRpc(db, "create_student", {
    p_group_id: groupId,
    p_display_name: input.displayName,
    p_username: input.username,
    p_op_key: input.opKey,
  });
}

export type StudentChanges = {
  revision: number;
  displayName: string;
  username: string;
};

/** `revision` is the one the caller read: a stale one is CONFLICT. */
export async function updateStudent(db: RpcDb, studentId: string, changes: StudentChanges): Promise<Written> {
  return callRpc(db, "update_student", {
    p_student_id: studentId,
    p_revision: changes.revision,
    p_display_name: changes.displayName,
    p_username: changes.username,
  });
}

export async function archiveStudent(db: RpcDb, studentId: string, revision: number): Promise<Written> {
  return callRpc(db, "archive_student", {
    p_student_id: studentId,
    p_revision: revision,
  });
}

export async function restoreStudent(db: RpcDb, studentId: string, revision: number): Promise<Written> {
  return callRpc(db, "restore_student", {
    p_student_id: studentId,
    p_revision: revision,
  });
}

export async function enrollStudent(db: RpcDb, groupId: string, studentId: string): Promise<{ id: string }> {
  return callRpc(db, "enroll_student", {
    p_group_id: groupId,
    p_student_id: studentId,
  });
}

export async function unenrollStudent(db: RpcDb, groupId: string, studentId: string): Promise<{ id: string }> {
  return callRpc(db, "unenroll_student", {
    p_group_id: groupId,
    p_student_id: studentId,
  });
}

export type StudentListOptions = {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

/** The students enrolled now, without their needs. */
export async function listGroupStudents(
  db: RpcDb,
  groupId: string,
  options: StudentListOptions = {},
): Promise<Page<GroupStudent>> {
  return callRpc(db, "list_group_students", {
    p_group_id: groupId,
    p_include_archived: options.includeArchived,
    p_limit: options.limit,
    p_offset: options.offset,
  });
}
