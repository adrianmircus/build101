import type { NextStep } from "@/lib/domain/accounts/results";
import type { Result } from "@/lib/errors";
import { failureKind, failureText } from "./failureText";
import type { FieldProblem } from "./ErrorSummary";
import { formatRetryTime } from "./retryTime";

// What the login screen shows after each try. Pure, so every state of the maqueta is tested without a browser.

export type LoginState =
  | { kind: "idle" }
  | { kind: "fields"; problems: FieldProblem[]; attempt: number }
  | { kind: "mismatch"; attempt: number }
  | { kind: "failed"; text: string; stale: boolean; attempt: number }
  | { kind: "blocked"; when: string | null }
  | { kind: "go"; next: string };

export const EMAIL_FIELD = "login-email";
export const PASSWORD_FIELD = "login-password";

export const MISSING_EMAIL = "Escribí tu correo, por ejemplo nombre@colegio.edu.uy.";
export const MISSING_PASSWORD = "Escribí tu contraseña.";
const BAD_EMAIL = "Revisá el correo: tiene que ser como nombre@colegio.edu.uy.";

/** What is missing before asking the server anything. */
export function missingFields(email: string, password: string): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (email.trim() === "") problems.push({ field: EMAIL_FIELD, message: MISSING_EMAIL, summary: "Escribí tu correo" });
  if (password === "") problems.push({ field: PASSWORD_FIELD, message: MISSING_PASSWORD });
  return problems;
}

export function missingTitle(count: number): string {
  return count === 1 ? "Falta completar un dato" : `Falta completar ${count} datos`;
}

/** The server's answer as a state. A wrong email and a wrong password are the same «mismatch»: the screen never says which. */
export function stateFromResult(result: Result<NextStep>, attempt: number, now = new Date()): LoginState {
  if (result.ok) return { kind: "go", next: result.data.next };
  const kind = failureKind(result);
  if (kind === "blocked") return { kind: "blocked", when: formatRetryTime(result.retryAt, { now }) };
  if (kind === "invalid" && result.fields?.email) return { kind: "fields", problems: [{ field: EMAIL_FIELD, message: BAD_EMAIL }], attempt };
  if (result.code === "NOT_FOUND" || result.code === "FORBIDDEN" || kind === "invalid") return { kind: "mismatch", attempt };
  return { kind: "failed", text: failureText(result), stale: kind === "stale", attempt };
}
