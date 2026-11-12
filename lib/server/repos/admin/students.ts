import "server-only";
import { callRpc, type RpcDb } from "../rpc";

// The internal_* RPC of students. It needs the admin client (service_role): only the account
// provisioning (T2.5) may link a student to an Auth user, never an id the browser sends.

/** Links a student to its Auth account and gives it the student role. Idempotent for the same pair. */
export async function linkStudentUser(admin: RpcDb, studentId: string, userId: string): Promise<{ id: string }> {
  return callRpc(admin, "internal_link_student_user", {
    p_student_id: studentId,
    p_user_id: userId,
  });
}
