import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verify } from "@/lib/auth/signing";

// Without a session for the right role, each area redirects to its login screen.
export function proxy(request: NextRequest) {
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

export const config = {
  matcher: ["/grupos/:path*", "/materia/:path*", "/estudiante/:path*", "/api/:path*"],
};
