import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { readPublicDbEnv } from "@/lib/server/db/env";

// What proxy.ts does with the Supabase session (T2.1): it refreshes the tokens on every request and writes the new
// cookies in the response (and in the request, so the page of this same request already sees them). Only the optimistic
// part: whether the person is allowed is decided by getActor() and the database, never here.

type CookieToSet = { name: string; value: string; options: CookieOptions };
export type SessionRefresh = { cookies: CookieToSet[]; headers: Record<string, string> };

// Paths that never refresh: jobs (they authenticate with their own secret), Next internals and static files.
const SKIPPED = /^\/(?:api\/jobs(?:\/|$)|_next(?:\/|$))|\.[A-Za-z0-9]+$/;

// Pages that carry a token in the fragment: nothing is cached and the Referer says nothing (fase-2.md, "Tokens").
const TOKEN_PAGES = ["/invitacion", "/t", "/ingresar/profesor/nueva"];

export function shouldRefresh(pathname: string): boolean {
  return !SKIPPED.test(pathname);
}

/** Supabase names its cookies `sb-<project>-auth-token` (and `.0`, `.1` when the value is split). */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-"));
}

/**
 * Verifies the session (getClaims) and refreshes it when the access token expired. Returns what Supabase wants written,
 * or null when there was nothing to do: no Supabase cookie (the demo and the visitors cost nothing), a path that is
 * skipped, no configuration, or Auth out of reach. It never throws: a failed refresh is a request without a session,
 * and the area rules and getActor() decide what that means.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefresh | null> {
  if (!shouldRefresh(request.nextUrl.pathname) || !hasSessionCookie(request)) return null;
  const refresh: SessionRefresh = { cookies: [], headers: {} };
  try {
    const { url, publishableKey } = readPublicDbEnv();
    const supabase = createServerClient(url, publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          refresh.cookies.push(...toSet);
          Object.assign(refresh.headers, headers);
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {
    return null;
  }
  for (const { name, value } of refresh.cookies) {
    if (value === "") request.cookies.delete(name);
    else request.cookies.set(name, value);
  }
  return refresh.cookies.length === 0 ? null : refresh;
}

/** The cookies and the no-cache headers Supabase asked for (a response with auth cookies must not be cached). */
export function applyRefresh(response: NextResponse, refresh: SessionRefresh): void {
  for (const { name, value, options } of refresh.cookies) response.cookies.set(name, value, options);
  for (const [key, value] of Object.entries(refresh.headers)) response.headers.set(key, value);
}

/** The pages with a token in the fragment never get cached and never leak a Referer. */
export function applyTokenPageHeaders(pathname: string, response: NextResponse): void {
  if (!TOKEN_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))) return;
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
}
