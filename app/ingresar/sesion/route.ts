import { NextResponse } from "next/server";
import {
  cleanStaleSession,
  loginAfterClean,
} from "@/lib/server/auth/login-gate";

// Where a login page sends a person whose session the database no longer recognizes (F2-5): a Route Handler can write the
// cookies, a Server Component cannot. It only closes a session that getActor() does not recognize, so opening this address
// with a live session does nothing. It never redirects to an address that comes in the request: only to the two logins.
export async function GET(request: Request) {
  await cleanStaleSession();
  const area = new URL(request.url).searchParams.get("a");
  const response = NextResponse.redirect(
    new URL(loginAfterClean(area), request.url),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
