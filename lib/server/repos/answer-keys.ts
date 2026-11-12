import "server-only";
import type { AnswerKey, AnswerKeyContent } from "@/lib/domain/assessments/generations";
import { callRpc, type RpcDb } from "./rpc";

// The answer key of a version (T1.4e). It never reaches a student. Revisions are append-only: every
// write answers the id of the revision it made, and the next write names it as its base.

export type KeyRevisionWritten = { revisionId: string; number: number };

export async function getAnswerKey(db: RpcDb, versionId: string): Promise<AnswerKey> {
  return callRpc(db, "get_answer_key", { p_version_id: versionId });
}

export type AnswerKeyEdit = {
  content: AnswerKeyContent;
  /** The revision the teacher edited; leave it out only for the very first key. A stale one is CONFLICT. */
  baseRevisionId?: string;
};

export async function editAnswerKey(db: RpcDb, versionId: string, edit: AnswerKeyEdit): Promise<KeyRevisionWritten> {
  return callRpc(db, "edit_answer_key", {
    p_version_id: versionId,
    p_content: edit.content,
    p_base_revision_id: edit.baseRevisionId,
  });
}

/** Makes a new revision with today's correct options and revisions, from `baseRevisionId`. */
export async function confirmAnswerKey(
  db: RpcDb,
  versionId: string,
  baseRevisionId: string,
): Promise<KeyRevisionWritten> {
  return callRpc(db, "confirm_answer_key", { p_version_id: versionId, p_base_revision_id: baseRevisionId });
}

export async function approveAnswerKey(
  db: RpcDb,
  versionId: string,
  revisionId: string,
): Promise<{ answerKeyId: string; approvedRevisionId: string; revision: number }> {
  return callRpc(db, "approve_answer_key", { p_version_id: versionId, p_revision_id: revisionId });
}
