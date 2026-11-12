import "server-only";
import { redirect } from "next/navigation";
import { getClaims, signOut } from "../repos/auth-session";
import { getActor } from "./actor";

// What a login page does with a person who already has a session (F2-5). It used to be proxy.ts, which only reads the claims
// of the token: a session closed by a new card still has valid claims, so the area sent the person to the login and the login
// sent them back to the area, forever, and the student never got to type the new password. Here the database speaks first:
//
// - a live actor of this kind goes to its home;
// - claims but no actor (closed session, account with no institution): the login is shown, and the session is cleaned
//   through /ingresar/sesion, because a Server Component cannot write cookies. The clean-up comes back with ?limpia=1 and then
//   never redirects again, so a session that cannot be cleaned still shows the login;
// - nothing, or an actor of the other kind: the login, as always.

export type LoginArea = "staff" | "student";

const HOME: Record<LoginArea, string> = {
  staff: "/grupos",
  student: "/estudiante",
};
export const LOGIN: Record<LoginArea, string> = {
  staff: "/ingresar/profesor",
  student: "/ingresar/estudiante",
};
export const CLEAN_PATH = "/ingresar/sesion";
export const CLEANED_FLAG = "limpia";

/** `cleaned`: the page was reached after the clean-up (?limpia=1); `canClean`: false where the page cannot take that trip (/t). */
export async function loginGate(
  area: LoginArea,
  options: { cleaned?: boolean; canClean?: boolean } = {},
): Promise<void> {
  let actor;
  let hasClaims = false;
  try {
    actor = await getActor();
    hasClaims = actor === null && (await getClaims()) !== null;
  } catch {
    // The database or Auth is out of reach: nothing is known about this person, and a session that may be fine is not cleaned.
    return;
  }
  if (actor?.kind === area) redirect(HOME[area]);
  if (hasClaims && options.cleaned !== true && options.canClean !== false)
    redirect(`${CLEAN_PATH}?a=${area}`);
}

/** Closes (locally) the session of this request if, and only if, the database does not recognize it. Never a live one. */
export async function cleanStaleSession(): Promise<void> {
  try {
    if ((await getActor()) !== null) return;
    await signOut("local");
  } catch {
    // Out of reach: the person sees the login anyway (?limpia=1), and the next request tries again.
  }
}

/** The login to land on after the clean-up: only the two known areas, never an address that came in the request. */
export function loginAfterClean(area: string | null): string {
  return `${LOGIN[area === "student" ? "student" : "staff"]}?${CLEANED_FLAG}=1`;
}
