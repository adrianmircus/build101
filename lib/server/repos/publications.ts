import "server-only";
import { callRpc, type RpcDb } from "./rpc";

// Publishing a version (T1.5a): the database copies the approved revision and creates or moves the
// attempts of the recipients. A repo only translates names and types.

export type Publish = {
  /** The revision the caller read: a stale one is CONFLICT. */
  revision: number;
  /** One per attempt, kept on a retry: the same key with the same data answers what was published. */
  opKey: string;
  /** Null or absent: in gaze mode the current key; in the other modes, no key. */
  answerKeyRevisionId?: string;
};

export type Published = { publicationId: string; attempts: number };

export async function publishVersion(db: RpcDb, versionId: string, input: Publish): Promise<Published> {
  return callRpc(db, "publish_version", {
    p_version_id: versionId,
    p_revision: input.revision,
    p_op_key: input.opKey,
    p_answer_key_revision_id: input.answerKeyRevisionId,
  });
}
