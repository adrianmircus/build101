import type { InviteRowResult } from "@/lib/domain/accounts/results";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { MAX_EMAILS, splitEmails } from "./emailList";
import type { Attempt } from "./opKey";
import type { ReviewRow } from "./inviteVerdicts";

// State of «Invitar profes»: paste, review, done.

export type InviteState = {
  step: "paste" | "review" | "done";
  text: string;
  role: InvitedRole;
  rows: ReviewRow[];
  results: InviteRowResult[];
  attempt: Attempt | null;
};

export type InviteAction =
  | { type: "text"; value: string }
  | { type: "role"; value: InvitedRole }
  | { type: "reviewing"; rows: ReviewRow[] }
  | { type: "back" }
  | { type: "attempt"; attempt: Attempt }
  | { type: "sent"; results: InviteRowResult[] }
  | { type: "again" };

export function initialInvite(): InviteState {
  return { step: "paste", text: "", role: "teacher", rows: [], results: [], attempt: null };
}

export function inviteReducer(state: InviteState, action: InviteAction): InviteState {
  switch (action.type) {
    case "text":
      return { ...state, text: action.value, attempt: null };
    case "role":
      return { ...state, role: action.value, attempt: null };
    case "reviewing":
      return { ...state, step: "review", rows: action.rows };
    case "back":
      return { ...state, step: "paste", rows: [] };
    case "attempt":
      return { ...state, attempt: action.attempt };
    case "sent":
      return { ...state, step: "done", results: action.results, attempt: null };
    case "again":
      return initialInvite();
  }
}

export type PasteProblem = "empty" | "too_many";

/** What is wrong with the pasted text before it can even be reviewed. */
export function pasteProblem(text: string): PasteProblem | null {
  const count = splitEmails(text).length;
  if (count === 0) return "empty";
  return count > MAX_EMAILS ? "too_many" : null;
}

export function pasteProblemText(problem: PasteProblem): string {
  return problem === "empty" ? "Pegá al menos un correo." : `Son más de ${MAX_EMAILS} correos. Mandalos de a ${MAX_EMAILS} por vez.`;
}

export function sendLabel(count: number): string {
  return count === 1 ? "Mandar 1 invitación" : `Mandar ${count} invitaciones`;
}
