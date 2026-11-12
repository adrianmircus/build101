import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/server/db/admin";
import { callRpc } from "@/lib/server/repos/rpc";
import { createMagicLinkClient } from "../../factories/clients";
import { signOutOfTheJar } from "../support/cookie-jar";
import { ip, issueAgain, purgeSchools, qrToken, registeredSessionsOf, required, sessionCookies, sessionsOf, tokenReads, watchFetch, withCard } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());
// The link of Auth is replaced only when a test says so: it plays an Auth that answers about another user or of another kind.
type Link = { hashedToken: string; userId: string; verificationType: string };
const link = vi.hoisted((): { override: (() => Promise<Link>) | null } => ({ override: null }));
vi.mock("@/lib/server/repos/admin/auth-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/repos/admin/auth-users")>("@/lib/server/repos/admin/auth-users");
  return { ...actual, magicLinkToken: (email: string) => (link.override === null ? actual.magicLinkToken(email) : link.override()) };
});

import { openStudentSession } from "@/lib/server/services/admin/student-login";
import { readAccessCard, signInStudent } from "@/lib/server/services/student-auth";

// What a login does when something changes under it (T2.5b): a card issued in the middle, an Auth that answers about another user, a
// session that Auth opened without our server, and the page of a card. The point of every one: no session that works is left behind.

const GENERIC = "El usuario o la contraseña no coinciden. Revisalos y probá de nuevo.";

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(() => {
  signOutOfTheJar();
  link.override = null;
});
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

const failed = (work: Promise<unknown>) => work.catch((thrown: unknown) => thrown);

describe("a card issued in the middle of a login", () => {
  it("between scrypt and Auth: the old password was right, but no session lives and no cookie is left", async () => {
    const { s, student, login, userId } = await withCard();
    const failure = await failed(signInStudent(login(), { afterPasswordCheck: async () => void (await issueAgain(s, student.id)) }));
    expect(failure).toMatchObject({ code: "FORBIDDEN", message: GENERIC });
    expect(sessionCookies()).toEqual([]);
    expect(await sessionsOf(userId)).toBe(0);
    expect(await registeredSessionsOf(userId)).toBe(0);
  });

  it("between verifyOtp and the bind: the session that Auth made is deleted by the bind and never registered", async () => {
    const { s, student, login, userId } = await withCard();
    const seen: number[] = [];
    const beforeBind = async () => {
      // The session already exists in Auth and has no cookie yet.
      seen.push(await sessionsOf(userId));
      await issueAgain(s, student.id);
    };
    const failure = await failed(signInStudent(login(), { beforeBind }));
    expect(seen).toEqual([1]);
    expect(failure).toMatchObject({ code: "FORBIDDEN", message: GENERIC });
    expect(sessionCookies()).toEqual([]);
    expect(await sessionsOf(userId)).toBe(0);
    expect(await registeredSessionsOf(userId)).toBe(0);
  });
});

describe("openStudentSession checks what Auth gives back", () => {
  it("generateLink for another user than the remembered id opens no session: the link is not exchanged", async () => {
    const mine = await withCard();
    const other = await withCard();
    const admin = createAdminClient();
    link.override = async () => {
      const made = await admin.auth.admin.generateLink({ type: "magiclink", email: `${other.userId}@estudiantes.usetiza.app` });
      return { hashedToken: required(made.data.properties?.hashed_token), userId: required(made.data.user?.id), verificationType: required(made.data.properties?.verification_type) };
    };
    const watch = watchFetch();
    expect(await openStudentSession(mine.userId, 1)).toBeNull();
    watch.restore();
    expect(watch.calls.some((call) => call.path.startsWith("/auth/v1/verify"))).toBe(false);
    expect(await sessionsOf(other.userId)).toBe(0);
    expect(await sessionsOf(mine.userId)).toBe(0);
    expect(await registeredSessionsOf(other.userId)).toBe(0);
  });

  it("a link of another kind than magiclink opens no session", async () => {
    const mine = await withCard();
    link.override = async () => ({ hashedToken: "x".repeat(40), userId: mine.userId, verificationType: "recovery" });
    const watch = watchFetch();
    expect(await openStudentSession(mine.userId, 1)).toBeNull();
    watch.restore();
    expect(watch.calls.some((call) => call.path.startsWith("/auth/v1/verify"))).toBe(false);
  });

  it("with the real Auth it gives the tokens, registered, and only for the version that is current", async () => {
    const mine = await withCard();
    const tokens = required(await openStudentSession(mine.userId, 1));
    expect(await registeredSessionsOf(mine.userId)).toBe(1);
    expect(await tokenReads(tokens.accessToken)).toBe(true);
    expect(await openStudentSession(mine.userId, 99)).toBeNull();
    expect(await registeredSessionsOf(mine.userId)).toBe(1);
  });
});

describe("a session that Auth opened without our server reads nothing", () => {
  it("verifyOtp directly (the way a guessed magic link would) is FORBIDDEN on every RPC of the student", async () => {
    const mine = await withCard();
    const client = await createMagicLinkClient(createAdminClient(), `${mine.userId}@estudiantes.usetiza.app`);
    await expect(callRpc(client, "student_home", {})).rejects.toMatchObject({ code: "FORBIDDEN", message: "Tu sesión terminó. Volvé a entrar." });
    await expect(callRpc(client, "list_my_institutions", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await registeredSessionsOf(mine.userId)).toBe(0);
  });
});

describe("readAccessCard", () => {
  it("gives the school and the username of a current card, never a name", async () => {
    const { s, student, card } = await withCard();
    const answer = await readAccessCard({ token: qrToken(card.qrUrl), ip: ip() });
    expect(answer).toEqual({ institutionCode: s.institution.code, institutionName: s.institution.name, username: student.username });
    expect(JSON.stringify(answer)).not.toContain("Alumna");
  });

  it("an unknown or revoked card is NOT_FOUND with a neutral text", async () => {
    const { s, student, card } = await withCard();
    await expect(readAccessCard({ token: "z".repeat(43), ip: ip() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await issueAgain(s, student.id);
    await expect(readAccessCard({ token: qrToken(card.qrUrl), ip: ip() })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Esta tarjeta ya no sirve. Si tu profe te dio una nueva, usá esa." });
  });

  it("every attempt counts against token_ip: the thirty-first from one IP is RATE_LIMITED", async () => {
    const from = ip();
    for (let attempt = 0; attempt < 30; attempt += 1) await readAccessCard({ token: "z".repeat(43), ip: from }).catch(() => undefined);
    await expect(readAccessCard({ token: "z".repeat(43), ip: from })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
