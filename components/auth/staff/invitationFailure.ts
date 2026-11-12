import type { Failure } from "@/lib/errors";
import type { FieldProblem } from "./ErrorSummary";
import { failureKind, failureText } from "./failureText";
import { formatRetryTime } from "./retryTime";

// What an invitation screen does when an action fails. Pure, so the table is tested. The context says which action:
// «new» creates the account, «signin» enters with the password of an existing one, «accept» only accepts with a session.

export type InviteContext = "new" | "signin" | "accept";

export type InviteOutcome =
  | { kind: "problems"; problems: FieldProblem[] }
  | { kind: "notice"; text: string }
  | { kind: "wrong-password" }
  | { kind: "have-account" }
  | { kind: "gone" }
  | { kind: "reload" };

export const NAME_FIELD = "invite-name";
export const PASSWORD_FIELD = "invite-password";
const FIELD_OF: Record<string, string> = { displayName: NAME_FIELD, password: PASSWORD_FIELD };

function problemsOf(failure: Failure): FieldProblem[] {
  return Object.entries(failure.fields ?? {}).flatMap(([name, message]) => (FIELD_OF[name] ? [{ field: FIELD_OF[name], message }] : []));
}

export function inviteOutcome(failure: Failure, context: InviteContext, now = new Date()): InviteOutcome {
  const kind = failureKind(failure);
  if (kind === "blocked") {
    const when = formatRetryTime(failure.retryAt, { now });
    return { kind: "notice", text: `Hubo demasiados intentos. Podés volver a probar ${when ?? "en unos minutos"}.` };
  }
  if (kind === "invalid") {
    const problems = problemsOf(failure);
    return problems.length > 0 ? { kind: "problems", problems } : { kind: "notice", text: failureText(failure) };
  }
  const byCode = outcomeByCode(failure.code, context);
  if (byCode) return byCode;
  return { kind: "notice", text: failureText(failure) };
}

/** The codes that say something about the invitation itself, by the action that was running. */
function outcomeByCode(code: Failure["code"], context: InviteContext): InviteOutcome | null {
  if (code === "NOT_FOUND") return { kind: "gone" };
  if (code === "CONFLICT") return context === "new" ? { kind: "have-account" } : { kind: "reload" };
  if (code === "FORBIDDEN") return context === "signin" ? { kind: "wrong-password" } : { kind: "reload" };
  return null;
}
