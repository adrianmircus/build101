import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { readPublicDbEnv } from "@/lib/server/db/env";
import type { Database } from "@/lib/server/db/types";
import { callRpc } from "@/lib/server/repos/rpc";
import { createGroup, createSchool } from "../../factories";
import { createMagicLinkClient, sessionIdOf, type TestClient } from "../../factories/clients";
import { bindStudentSession, createStudent, createStudentAccount } from "../../factories/students";
import { readRows } from "../support/db";

// F2C-75, F2C-78: the session of a student reads data only if our server registered it (the bind) with the current version of
// his credential. The sessions here are real: generateLink and verifyOtp against the local Auth, like the login of a student.
// An access token that is still valid is replayed through a client that carries only the header.

const PLACEHOLDER_HASH = `scrypt$15$8$1$${Buffer.alloc(16, 3).toString("base64")}$${Buffer.alloc(64, 4).toString("base64")}`;
const NO_SESSION = { code: "FORBIDDEN", message: "Tu sesión terminó. Volvé a entrar." };

/** A client with only the access token in a header: a request that carries a token that is still valid. */
function clientWith(accessToken: string): TestClient {
  const { url, publishableKey } = readPublicDbEnv();
  return createClient<Database, "api">(url, publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function tokenOf(client: TestClient): Promise<string> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (token === undefined) throw new Error("El cliente no tiene sesión.");
  return token;
}

/** A school with a teacher, a group and a student who has an account and a credential, and no session yet. */
async function scene() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const student = await createStudent(school.teacher.client, group.id);
  const account = await createStudentAccount(school.admin, student);
  return { ...school, group, student, account };
}

type Scene = Awaited<ReturnType<typeof scene>>;

/** A new session, opened as the login does: generateLink and verifyOtp, with no registry row. */
const openSession = (s: Scene) => createMagicLinkClient(s.admin, s.account.email);

const registered = async (sessionId: string) =>
  Number((await readRows<{ n: string }>("select count(*)::text as n from app.student_sessions where session_id = $1", [sessionId]))[0]?.n);

const reads = (client: TestClient) => ({
  institutions: () => callRpc(client, "list_my_institutions", {}),
  home: () => callRpc(client, "student_home", {}),
});

async function issueCard(s: Scene): Promise<void> {
  await callRpc(s.teacher.client, "issue_access_cards", {
    p_group_id: s.group.id,
    p_cards: [{ studentId: s.student.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), passwordHash: PLACEHOLDER_HASH }],
    p_op_key: randomUUID(),
  });
}

describe("the session of a student: it reads only when our server registered it", () => {
  it("without the bind, list_my_institutions and a student_* RPC are FORBIDDEN no_session; with it they pass", async () => {
    const s = await scene();
    const client = await openSession(s);
    const sessionId = await sessionIdOf(client);

    await expect(reads(client).institutions()).rejects.toMatchObject(NO_SESSION);
    await expect(reads(client).home()).rejects.toMatchObject(NO_SESSION);
    expect(await registered(sessionId)).toBe(0);

    await bindStudentSession(s.admin, s.account.userId, sessionId);
    expect(await registered(sessionId)).toBe(1);
    await expect(reads(client).institutions()).resolves.toBeDefined();
    await expect(reads(client).home()).resolves.toBeDefined();
  });

  it("a session that is not the one that was bound stays closed: another open session of the same student", async () => {
    const s = await scene();
    const bound = await openSession(s);
    const other = await openSession(s);
    await bindStudentSession(s.admin, s.account.userId, await sessionIdOf(bound));
    await expect(reads(bound).home()).resolves.toBeDefined();
    await expect(reads(other).home()).rejects.toMatchObject(NO_SESSION);
  });

  it("after issue_access_cards neither the registered session nor its access token reads any more", async () => {
    const s = await scene();
    const client = await openSession(s);
    const sessionId = await sessionIdOf(client);
    await bindStudentSession(s.admin, s.account.userId, sessionId);
    const token = await tokenOf(client);
    await expect(reads(clientWith(token)).home()).resolves.toBeDefined();

    await issueCard(s);

    await expect(reads(clientWith(token)).institutions()).rejects.toMatchObject(NO_SESSION);
    await expect(reads(clientWith(token)).home()).rejects.toMatchObject(NO_SESSION);
    expect(await registered(sessionId)).toBe(0);
    const sessions = await readRows<{ n: string }>("select count(*)::text as n from auth.sessions where user_id = $1", [s.account.userId]);
    expect(sessions[0]?.n).toBe("0");
  });

  it("a session opened after the new card and bound with the new version reads again", async () => {
    const s = await scene();
    await issueCard(s);
    const client = await openSession(s);
    await bindStudentSession(s.admin, s.account.userId, await sessionIdOf(client));
    await expect(reads(client).home()).resolves.toBeDefined();
  });

  it("signing out deletes the registry row (the foreign key) and the old token stops reading", async () => {
    const s = await scene();
    const client = await openSession(s);
    const sessionId = await sessionIdOf(client);
    await bindStudentSession(s.admin, s.account.userId, sessionId);
    const token = await tokenOf(client);
    await expect(reads(clientWith(token)).home()).resolves.toBeDefined();

    const { error } = await client.auth.signOut({ scope: "local" });
    expect(error).toBeNull();

    expect(await registered(sessionId)).toBe(0);
    const refused = await reads(clientWith(token)).home().catch((thrown: unknown) => thrown);
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject(NO_SESSION);
  });

  it("the registry row survives a refresh of the token: the session is the same", async () => {
    const s = await scene();
    const client = await openSession(s);
    const sessionId = await sessionIdOf(client);
    await bindStudentSession(s.admin, s.account.userId, sessionId);
    const before = await tokenOf(client);

    const refreshed = await client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const after = await tokenOf(client);
    expect(after).not.toBe(before);
    expect(await sessionIdOf(client)).toBe(sessionId);

    expect(await registered(sessionId)).toBe(1);
    await expect(reads(client).institutions()).resolves.toBeDefined();
    await expect(reads(client).home()).resolves.toBeDefined();
    await expect(reads(clientWith(after)).home()).resolves.toBeDefined();
  });

  it("the bind with a version that is no longer the current one deletes the session and registers nothing", async () => {
    const s = await scene();
    const client = await openSession(s);
    const sessionId = await sessionIdOf(client);
    await issueCard(s);
    // The login had read version 1; the teacher issued in between (version 2).
    const bound = await callRpc(s.admin, "internal_bind_student_session", { p_auth_user_id: s.account.userId, p_session_id: sessionId, p_version: 1 });
    expect(bound).toEqual({ ok: false });
    expect(await registered(sessionId)).toBe(0);
    const left = await readRows<{ n: string }>("select count(*)::text as n from auth.sessions where id = $1", [sessionId]);
    expect(left[0]?.n).toBe("0");
    await expect(reads(client).home()).rejects.toMatchObject(NO_SESSION);
  });

  it("a teacher keeps reading with his own session: the check of the student does not touch staff", async () => {
    const s = await scene();
    await expect(reads(s.teacher.client).institutions()).resolves.toBeDefined();
  });
});
