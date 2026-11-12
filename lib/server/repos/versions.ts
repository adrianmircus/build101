import "server-only";
import type { Written } from "@/lib/domain/common";
import type { VersionDetail, VersionSummary } from "@/lib/domain/assessments/rpc-versions";
import type { AnswerMode, VersionConfig } from "@/lib/domain/assessments/versions";
import { callRpc, type RpcDb } from "./rpc";

// Versions of an assessment (T1.4b: configuration and recipients). The config, the answer mode and
// the recipients together reveal profiles: getVersion is audited, so wrap the client with
// withRequestId. The database says who may do what; a repo only translates names and types.

export type NewVersion = {
  config: VersionConfig;
  answerMode: AnswerMode;
  /** The version it starts from. */
  baseVersionId?: string;
  /** One per attempt, kept on a retry: the same key never creates the version twice. */
  opKey: string;
};

export type CreatedVersion = { id: string; revision: number; position: number };

export async function createVersion(db: RpcDb, assessmentId: string, input: NewVersion): Promise<CreatedVersion> {
  return callRpc(db, "create_version", {
    p_assessment_id: assessmentId,
    p_config: input.config,
    p_answer_mode: input.answerMode,
    p_op_key: input.opKey,
    p_base_version_id: input.baseVersionId,
  });
}

/** `revision` is the one the caller read: a stale one is CONFLICT. */
export type VersionConfigChanges = { revision: number; config: VersionConfig; answerMode: AnswerMode };

export async function updateVersionConfig(db: RpcDb, versionId: string, changes: VersionConfigChanges): Promise<Written> {
  return callRpc(db, "update_version_config", {
    p_version_id: versionId,
    p_revision: changes.revision,
    p_config: changes.config,
    p_answer_mode: changes.answerMode,
  });
}

export type RecipientChanges = {
  revision: number;
  /** The whole set the version is for, not a delta. */
  studentIds: string[];
  /** One per attempt, kept on a retry: the same id never applies the change twice. */
  opId: string;
};

export async function setVersionRecipients(db: RpcDb, versionId: string, changes: RecipientChanges): Promise<Written> {
  return callRpc(db, "set_version_recipients", {
    p_version_id: versionId,
    p_revision: changes.revision,
    p_student_ids: changes.studentIds,
    p_op_id: changes.opId,
  });
}

export async function archiveVersion(db: RpcDb, versionId: string, revision: number): Promise<Written> {
  return callRpc(db, "archive_version", { p_version_id: versionId, p_revision: revision });
}

/** Without config, answer mode or recipients: it leaves no audit row. */
export async function listVersions(db: RpcDb, assessmentId: string): Promise<VersionSummary[]> {
  const { items } = await callRpc(db, "list_versions", { p_assessment_id: assessmentId });
  return items;
}

/** The teacher's review, with recipients and keys. Audited when it shows students. */
export async function getVersion(db: RpcDb, versionId: string): Promise<VersionDetail> {
  return callRpc(db, "get_version", { p_version_id: versionId });
}
