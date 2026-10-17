import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verify } from "@/lib/auth/signing";

// Without a session for the right role, each area redirects to its login screen.
export function proxy(request: NextRequest) {
  const session = verify(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/groups") && session?.role !== "teacher") {
    return NextResponse.redirect(new URL("/login/teacher", request.url));
  }
  if (pathname.startsWith("/student") && session?.role !== "student") {
    return NextResponse.redirect(new URL("/login/student", request.url));
  }
}

export const config = {
  matcher: ["/groups/:path*", "/student/:path*"],
};
