import "server-only";
import { AppError } from "@/lib/errors";
import { getActor, requireStaff } from "./actor";

// The check of the routes that call an AI provider (F2-3). proxy.ts only reads the claims of the token: a session closed by a
// new card, or an account with no membership, still passes it. Here the database has the last word, and it speaks BEFORE any
// provider is touched: a request that is not from a staff member never costs a token. The routes answer { error } with a text
// the front shows as it is (the shape these routes always had); the rest of the entries use defineRoute and Result.
// The demo never gets here: it has no Supabase session, so proxy.ts answers it 403 before the route runs (proxy.test.ts).

const EXPIRED = "Tu sesión venció. Volvé a ingresar.";
const STUDENT = "Esto es solo para profesores. Entrá con tu cuenta de profesor.";
const UNREACHABLE = "No pudimos verificar tu sesión. Probá de nuevo en un momento.";

const refuse = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * null when the request comes from a staff member with a live session; otherwise the Response to return as it is:
 * 403 for a student, 401 for no session (revoked, expired, or an account with no institution; the demo is 403 in the proxy),
 * 503 if the check itself could not be made.
 */
export async function aiGate(): Promise<Response | null> {
  try {
    await requireStaff();
    return null;
  } catch (thrown) {
    if (!(thrown instanceof AppError)) return refuse(UNREACHABLE, 503);
  }
  // Not staff: tell a student from a closed session, only to say the right thing (both are refused).
  try {
    return (await getActor()) === null ? refuse(EXPIRED, 401) : refuse(STUDENT, 403);
  } catch {
    return refuse(UNREACHABLE, 503);
  }
}
