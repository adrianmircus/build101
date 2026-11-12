import "server-only";
import type { ProfileId, StudentNeedEvent, StudentNeeds, SupportId } from "@/lib/domain/students/needs";
import type { Page } from "./groups";
import { callRpc, type RpcDb } from "./rpc";

// Needs are health data. Every read is audited by the database (one audit_log row per request):
// pass a client wrapped with withRequestId so that row carries the id of the request. The repo
// never caches and never logs what it reads.

export type NeedsInput = {
  profiles: ProfileId[];
  supports: SupportId[];
  interests: string[];
  /** One per attempt, kept on a retry. */
  opId: string;
  /** The revision the caller read; omitted when the student has no needs row yet. */
  revision?: number;
  reviewDueOn?: string;
};

/** Replaces the needs of the student and keeps the previous ones in the history. */
export async function setStudentNeeds(
  db: RpcDb,
  studentId: string,
  input: NeedsInput,
): Promise<{ studentId: string; revision: number }> {
  return callRpc(db, "set_student_needs", {
    p_student_id: studentId,
    p_profiles: input.profiles,
    p_supports: input.supports,
    p_interests: input.interests,
    p_op_id: input.opId,
    p_revision: input.revision,
    p_review_due_on: input.reviewDueOn,
  });
}

/** Up to 200 students of one institution; the ones without a needs row are simply not in the list. */
export async function getStudentNeeds(db: RpcDb, studentIds: string[]): Promise<StudentNeeds[]> {
  const { items } = await callRpc(db, "get_student_needs", {
    p_student_ids: studentIds,
  });
  return items;
}

/** The needs of the students enrolled now and not archived. */
export async function getGroupNeeds(db: RpcDb, groupId: string): Promise<StudentNeeds[]> {
  const { items } = await callRpc(db, "get_group_needs", {
    p_group_id: groupId,
  });
  return items;
}

export type NeedEventsOptions = { limit?: number; offset?: number };

/** Newest first: what changed, from what, and who did it. */
export async function listStudentNeedEvents(
  db: RpcDb,
  studentId: string,
  options: NeedEventsOptions = {},
): Promise<Page<StudentNeedEvent>> {
  return callRpc(db, "list_student_need_events", {
    p_student_id: studentId,
    p_limit: options.limit,
    p_offset: options.offset,
  });
}
