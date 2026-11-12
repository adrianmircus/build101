import type { Accepted, InvitationPublic } from "@/lib/domain/accounts/results";
import { Token } from "@/lib/domain/accounts/inputs";
import { callAction } from "@/lib/client/callAction";
import type { ActionFn } from "./actionFn";
import { failureText } from "./failureText";

// What the invitation page is showing. «gone» is an invitation that does not exist or was taken away while open.
export type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "gone" }
  | { kind: "error"; text: string }
  | { kind: "ready"; invitation: InvitationPublic }
  | { kind: "done"; institutionName: string; accepted: Accepted };

/** Reads the invitation the token points to, and says what the page shows. A token that is not one never reaches the server. */
export async function invitationPhaseFor(read: ActionFn<{ token: string }, InvitationPublic>, token: string): Promise<Phase> {
  if (!Token.safeParse(token).success) return { kind: "missing" };
  const result = await callAction(read, { token });
  if (result.ok) return { kind: "ready", invitation: result.data };
  return result.code === "NOT_FOUND" ? { kind: "gone" } : { kind: "error", text: failureText(result) };
}
