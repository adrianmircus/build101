import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { readPublicDbEnv } from "@/lib/server/db/env";
import type { Database } from "@/lib/server/db/types";
import { callRpc } from "@/lib/server/repos/rpc";
import { createLoggedInUser, createSchool } from "../../factories";
import { readRows } from "../support/db";

// F2C-9: a session that was closed stops reading. A real session is opened with signInWithPassword of a staff of the
// factories; internal_revoke_user_sessions deletes it from auth.sessions; the access token (still not expired) then
// finds nothing through any RPC. The token of another user, and the same user without a session_id, are not affected.

const sessionsOf = async (userId: string) =>
  Number((await readRows<{ n: string }>("select count(*)::text as n from auth.sessions where user_id = $1", [userId]))[0]?.n);

/** A client with only the access token in a header, like a request that carries a token that is still valid. */
function clientWith(accessToken: string) {
  const { url, publishableKey } = readPublicDbEnv();
  return createClient<Database, "api">(url, publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describe("a closed session stops reading data", () => {
  it("the access token works, the session is revoked, and the same token gets FORBIDDEN no_session", async () => {
    const school = await createSchool();
    const other = await createLoggedInUser(school.admin, school.institution, "teacher");

    const { data } = await school.teacher.client.auth.getSession();
    const token = data.session?.access_token ?? "";
    expect(token).not.toBe("");
    const claims = z.object({ session_id: z.string().min(1), exp: z.number() }).parse(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()));
        expect(claims.exp * 1000).toBeGreaterThan(Date.now());

    const client = clientWith(token);
    await expect(callRpc(client, "list_my_institutions", {})).resolves.toBeDefined();
    expect(await sessionsOf(school.teacher.id)).toBe(1);

    const revoked = await callRpc(school.admin, "internal_revoke_user_sessions", { p_user_id: school.teacher.id });
    expect(revoked.revoked).toBe(1);
    expect(await sessionsOf(school.teacher.id)).toBe(0);

    const refused = await callRpc(client, "list_my_institutions", {}).catch((thrown: unknown) => thrown);
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ code: "FORBIDDEN", message: "Tu sesión terminó. Volvé a entrar." });

    // The session of another user did not move.
    expect(await sessionsOf(other.id)).toBe(1);
    await expect(callRpc(other.client, "list_my_institutions", {})).resolves.toBeDefined();
  });

  it("signing in again after the revoke opens a new session that works, and the old token stays dead", async () => {
    const school = await createSchool();
    const old = (await school.teacher.client.auth.getSession()).data.session?.access_token ?? "";
    await callRpc(school.admin, "internal_revoke_user_sessions", { p_user_id: school.teacher.id });

    const fresh = createClient<Database, "api">(readPublicDbEnv().url, readPublicDbEnv().publishableKey, {
      db: { schema: "api" },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const signedIn = await fresh.auth.signInWithPassword({ email: school.teacher.email, password: school.teacher.password });
    expect(signedIn.error).toBeNull();
    await expect(callRpc(fresh, "list_my_institutions", {})).resolves.toBeDefined();
    await expect(callRpc(clientWith(old), "list_my_institutions", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
