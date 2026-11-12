import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verify, type Session } from "@/lib/auth/signing";
import { DEMO_COOKIE } from "@/lib/demo/mode";
import { applyRefresh, applyTokenPageHeaders, refreshSession, type SessionKind } from "@/lib/server/auth/session-proxy";

// The optimistic rules of each area (T2.8): a session of Supabase (its claims, checked in session-proxy.ts) or the signed
// cookie of the demo. The real check is getActor() and the database; this only picks the screen or the login. The cookie of
// the demo opens the demo and nothing else: no page of the institution, no API with the AI. The logins are NOT decided here: a
// claim says nothing about a session that was closed since (a new card), so each login page asks getActor() (lib/server/auth/login-gate.ts).

const STAFF_LOGIN = "/ingresar/profesor";
const STUDENT_LOGIN = "/ingresar/estudiante";

const inArea = (pathname: string, area: string) => pathname === area || pathname.startsWith(`${area}/`);

const redirectTo = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.url));

function apiRules(pathname: string, kind: SessionKind | null, demo: Session | null): NextResponse | undefined {
  // Reading aloud is for anyone who is inside: a session of either kind, or the demo (whose answer the route decides).
  if (pathname === "/api/tts") {
    if (kind !== null || demo !== null) return;
    return NextResponse.json({ error: "Tu sesión venció. Volvé a ingresar." }, { status: 401 });
  }
  if (kind === "staff") return;
  // Every other API calls the AI: anyone can enter the demo from the landing, so it never spends.
  if (kind === null && demo !== null) {
    return NextResponse.json(
      { error: "En la demo no se usa la IA en vivo. Ingresá con tu cuenta para probarla." },
      { status: 403 },
    );
  }
  return NextResponse.json({ error: "Tu sesión venció. Volvé a ingresar." }, { status: 401 });
}

function pageRules(request: NextRequest, kind: SessionKind | null, demo: Session | null): NextResponse | undefined {
  const { pathname } = request.nextUrl;
  if (inArea(pathname, "/grupos") || inArea(pathname, "/materia")) {
    return kind === "staff" || demo?.role === "teacher" ? undefined : redirectTo(request, STAFF_LOGIN);
  }
  if (inArea(pathname, "/estudiante")) {
    return kind === "student" || demo?.role === "student" ? undefined : redirectTo(request, STUDENT_LOGIN);
  }
  if (inArea(pathname, "/institucion")) {
    // The demo has no institution. Whether this staff is an admin of that one is decided by requireAdmin.
    return kind === "staff" ? undefined : redirectTo(request, STAFF_LOGIN);
  }
}

export async function proxy(request: NextRequest) {
  // The refresh goes first: it updates the cookies of the request that the page will read.
  const { refresh, kind } = await refreshSession(request);
  const { pathname } = request.nextUrl;
  // A real session wins over the demo: whoever has one open is not in the demo, whatever cookies are left over. They are
  // dropped from this request too, so the page that renders now does not read them: the demo is asked first, with no trip to
  // the database, and it can only be there if nobody is signed in.
  const leftovers = kind !== null && !inArea(pathname, "/demo") ? [SESSION_COOKIE, DEMO_COOKIE].filter((name) => request.cookies.has(name)) : [];
  const signed = verify(request.cookies.get(SESSION_COOKIE)?.value);
  const demo = kind === null && signed?.demo === true ? signed : null;
  for (const name of leftovers) request.cookies.delete(name);
  const response =
    (pathname.startsWith("/api/") ? apiRules(pathname, kind, demo) : pageRules(request, kind, demo)) ??
    NextResponse.next({ request });
  if (refresh) applyRefresh(response, refresh);
  for (const name of leftovers) response.cookies.delete(name);
  applyTokenPageHeaders(pathname, response);
  return response;
}

// Everything but Next internals, static files and the jobs (which have their own secret). The pages with a token
// (/invitacion, /t, /ingresar/profesor/nueva) need to be inside to get their headers.
export const config = {
  matcher: ["/((?!_next/|api/jobs(?:/|$)|.*[.][A-Za-z0-9]+$).*)"],
};
