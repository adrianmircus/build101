import { readAccessCardAction } from "@/app/ingresar/estudiante/actions";
import { callAction } from "@/lib/client/callAction";
import { viewOfFailure } from "./failure-view";

export type CardOutcome =
  | { kind: "card"; code: string; name: string; username: string }
  | { kind: "pause"; retryAt: string | undefined }
  | { kind: "unusable" }
  | { kind: "unavailable" };

/** Sends the token of a scanned or opened card (in the body of a POST, never in a URL) and says what came back. */
export async function readCard(token: string): Promise<CardOutcome> {
  const result = await callAction(readAccessCardAction, { token });
  if (result.ok) {
    const { institutionCode, institutionName, username } = result.data;
    return { kind: "card", code: institutionCode, name: institutionName, username };
  }
  const view = viewOfFailure(result);
  if (view.kind === "pause") return view;
  return view.notice.kind === "wrong" ? { kind: "unusable" } : { kind: "unavailable" };
}
