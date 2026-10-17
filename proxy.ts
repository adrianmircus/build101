import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verify } from "@/lib/auth/signing";

// Without a session for the right role, each area redirects to its login screen.
export function proxy(request: NextRequest) {
  const session = verify(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  const teacherArea = pathname.startsWith("/grupos") || pathname.startsWith("/materia");
  if (teacherArea && session?.role !== "teacher") {
    return NextResponse.redirect(new URL("/ingresar/profesor", request.url));
  }
  if (pathname.startsWith("/estudiante") && session?.role !== "student") {
    return NextResponse.redirect(new URL("/ingresar/estudiante", request.url));
  }
}

export const config = {
  matcher: ["/grupos/:path*", "/materia/:path*", "/estudiante/:path*"],
};
