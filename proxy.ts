import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verify } from "@/lib/auth/signing";
import { applyRefresh, applyTokenPageHeaders, refreshSession } from "@/lib/server/auth/session-proxy";

// Without a session for the right role, each area redirects to its login screen. These rules still read the signed
// cookie of the demo; T2.8 moves them to the Supabase session.
function areaRules(request: NextRequest): NextResponse | undefined {
  const session = verify(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  // APIs answer 401 instead of redirecting. Dictation (/api/answers), voice commands (/api/voice) and reading aloud
  // (/api/tts) are used by students too; the rest is the teacher's.
  if (pathname.startsWith("/api/")) {
    // Every API calls the AI (or ElevenLabs): anyone can enter the demo from the landing, so it never spends.
    if (session?.demo) {
      return NextResponse.json(
        { error: "En la demo no se usa la IA en vivo. Ingresá con tu cuenta para probarla." },
        { status: 403 },
      );
    }
    const anyRole = pathname.startsWith("/api/answers/") || pathname.startsWith("/api/voice/") || pathname === "/api/tts";
    const allowed = anyRole ? session !== null : session?.role === "teacher";
    if (!allowed) return NextResponse.json({ error: "Tu sesión venció. Volvé a ingresar." }, { status: 401 });
    return;
  }
  const teacherArea = pathname.startsWith("/grupos") || pathname.startsWith("/materia");
  if (teacherArea && session?.role !== "teacher") {
    return NextResponse.redirect(new URL("/ingresar/profesor", request.url));
  }
  if (pathname.startsWith("/estudiante") && session?.role !== "student") {
    return NextResponse.redirect(new URL("/ingresar/estudiante", request.url));
  }
}

export async function proxy(request: NextRequest) {
  // The refresh goes first: it updates the cookies of the request that the page will read.
  const refresh = await refreshSession(request);
  const response = areaRules(request) ?? NextResponse.next({ request });
  if (refresh) applyRefresh(response, refresh);
  applyTokenPageHeaders(request.nextUrl.pathname, response);
  return response;
}

// Everything but Next internals, static files and the jobs (which have their own secret). The pages with a token
// (/invitacion, /t, /ingresar/profesor/nueva) need to be inside to get their headers.
export const config = {
  matcher: ["/((?!_next/|api/jobs(?:/|$)|.*[.][A-Za-z0-9]+$).*)"],
};
