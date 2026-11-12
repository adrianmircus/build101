import { signInStudentAction } from "@/app/ingresar/estudiante/actions";
import { callAction } from "@/lib/client/callAction";
import { viewOfFailure, type Notice } from "./failure-view";

export type LoginOutcome =
  | { kind: "in"; next: string }
  | { kind: "notice"; notice: Notice }
  | { kind: "pause"; retryAt: string | undefined };

/** One sign in attempt. The password is sent as typed: the server normalizes it (spaces, capitals) before checking. */
export async function runLogin(values: { code: string; username: string; password: string }): Promise<LoginOutcome> {
  const result = await callAction(signInStudentAction, values);
  if (result.ok) return { kind: "in", next: result.data.next };
  return viewOfFailure(result);
}
