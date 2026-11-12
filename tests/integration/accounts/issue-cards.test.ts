import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/lib/server/auth/password-hash";
import { createAdminClient } from "@/lib/server/db/admin";
import { createAuthUser } from "@/lib/server/repos/admin/auth-users";
import { callRpc } from "@/lib/server/repos/rpc";
import { signOutOfTheJar } from "../support/cookie-jar";
import { readRows } from "../support/db";
import { asTeacher, authRow, authUserOf, credentialOf, ip, jarAccessToken, ORIGIN, purgeSchools, qrToken, required, scene, tokenReads, watchFetch } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { issueAccessCards } from "@/lib/server/services/student-accounts";
import { signInStudent } from "@/lib/server/services/student-auth";

// Issuing the cards (T2.5b, «Emitir tarjetas») against the local Supabase: whoever has no account gets one, one transaction in the
// database, the new password works and the old one does not, the session that was open stops reading, and two requests at once
// leave only the last one working. Who may issue is in issue-authorize.test.ts.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(signOutOfTheJar);
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const activeToken = async (studentId: string) =>
  required((await readRows<{ hash: string }>("select encode(token_hash, 'hex') as hash from app.access_cards where student_id = $1 and status = 'active'", [studentId]))[0]).hash;
const activeCards = async (studentId: string) =>
  Number((await readRows<{ n: string }>("select count(*)::text as n from app.access_cards where student_id = $1 and status = 'active'", [studentId]))[0]?.n);

type Scene = Awaited<ReturnType<typeof scene>>;
const request = (s: Scene) => ({ groupId: s.groupId, studentIds: s.students.map((student) => student.id), opKey: randomUUID(), origin: ORIGIN });
const remember = (provisioningId: string, id = randomUUID()) =>
  callRpc(createAdminClient(), "internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: id }).then(() => id);

describe("issueAccessCards", () => {
  it("gives every student an account and a card: three words and a number, a QR url with the token in the fragment, and only hashes in the database", async () => {
    const s = await scene(3);
    const { cards, others } = await issueAccessCards(request(s));
    expect(others).toEqual([]);
    expect(cards).toHaveLength(3);
    for (const student of s.students) {
      const card = required(cards.find((item) => item.studentId === student.id));
      expect(card).toMatchObject({ displayName: student.displayName, username: student.username, institutionCode: s.institution.code });
      expect(card.password).toMatch(/^[a-z]{3,5}-[a-z]{3,5}-[a-z]{3,5}-[2-9][2-9]$/);
      expect(card.qrUrl).toMatch(/^http:\/\/localhost:3000\/t#[A-Za-z0-9_-]{43}$/);
      expect(await activeToken(student.id)).toBe(sha256(qrToken(card.qrUrl)));
      const credential = required(await credentialOf(student.id));
      expect(credential.version).toBe(1);
      expect(credential.hash).not.toContain(card.password);
      expect(await verifyPassword(card.password, credential.hash)).toBe(true);
      expect(required(await authRow(await authUserOf(student))).password).toBe("");
    }
  });

  it("writes nothing in Auth when it issues: a second issue makes no admin call and leaves the account as it was", async () => {
    const s = await scene(1);
    await issueAccessCards(request(s));
    const id = await authUserOf(required(s.students[0]));
    const before = await authRow(id);

    const watch = watchFetch();
    await issueAccessCards(request(s));
    watch.restore();
    expect(watch.calls.filter((call) => call.path.startsWith("/auth/v1/admin/"))).toEqual([]);
    expect(await authRow(id)).toEqual(before);
  });

  it("a new card: the new password works, the old one does not, and the session that was open stops reading", async () => {
    const s = await scene(1);
    const student = required(s.students[0]);
    const first = required((await issueAccessCards(request(s))).cards[0]);
    const login = { code: s.institution.code, username: student.username, ip: ip() };
    await signInStudent({ ...login, password: first.password });
    const token = await jarAccessToken();
    expect(await tokenReads(token)).toBe(true);

    await asTeacher(s);
    const second = required((await issueAccessCards(request(s))).cards[0]);
    expect(second.password).not.toBe(first.password);
    expect(await tokenReads(token)).toBe(false);
    expect(await activeCards(student.id)).toBe(1);

    signOutOfTheJar();
    await expect(signInStudent({ ...login, password: first.password })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await signInStudent({ ...login, password: second.password })).toEqual({ next: "/estudiante" });
    expect(await tokenReads(await jarAccessToken())).toBe(true);
  });

  it("two requests at once for the same student: the cards of the last one to commit are the ones that work", async () => {
    const s = await scene(1);
    const student = required(s.students[0]);
    const [a, b] = await Promise.all([issueAccessCards(request(s)), issueAccessCards(request(s))]);
    const printed = [required(a.cards[0]), required(b.cards[0])];

    const credential = required(await credentialOf(student.id));
    const working = await Promise.all(printed.map((card) => verifyPassword(card.password, credential.hash)));
    expect(working.filter(Boolean)).toHaveLength(1);
    expect(credential.version).toBe(2);
    const winner = required(printed[working.indexOf(true)]);
    const loser = required(printed[working.indexOf(false)]);
    // The one that works is the active card; the other was revoked and its password is of no use.
    expect(await activeToken(student.id)).toBe(sha256(qrToken(winner.qrUrl)));
    expect(await activeCards(student.id)).toBe(1);

    signOutOfTheJar();
    const login = { code: s.institution.code, username: student.username, ip: ip() };
    await expect(signInStudent({ ...login, password: loser.password })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await signInStudent({ ...login, password: winner.password })).toEqual({ next: "/estudiante" });
  });

  it("repeating a request is CONFLICT with the text for «ya se crearon»: it cannot give the passwords back", async () => {
    const s = await scene(1);
    const repeated = request(s);
    await issueAccessCards(repeated);
    await expect(issueAccessCards(repeated)).rejects.toMatchObject({ code: "CONFLICT", message: "Las tarjetas ya se crearon. Si no llegaste a imprimirlas, creá nuevas." });
  });

  it("a student whose account Auth does not confirm comes back as `uncertain`, and the others get their card", async () => {
    const s = await scene(2);
    const [first, second] = [required(s.students[0]), required(s.students[1])];
    const id = await remember(first.provisioningId);
    const down = watchFetch((call) => (call.method === "GET" && call.path === `/auth/v1/admin/users/${id}` ? new Response("{}", { status: 500 }) : undefined));
    const { cards, others } = await issueAccessCards(request(s));
    down.restore();
    expect(others).toEqual([{ studentId: first.id, outcome: "uncertain" }]);
    expect(cards.map((card) => card.studentId)).toEqual([second.id]);
    expect(await credentialOf(first.id)).toBeUndefined();
    expect(await activeCards(first.id)).toBe(0);
  });

  it("a student whose account belongs to another provisioning comes back as `failed`, and the others get their card", async () => {
    const s = await scene(2);
    const [first, second] = [required(s.students[0]), required(s.students[1])];
    const id = await remember(first.provisioningId);
    await createAuthUser({ id, email: `${id}@estudiantes.usetiza.app`, appMetadata: { provisioning_id: randomUUID() } });
    const { cards, others } = await issueAccessCards(request(s));
    expect(others).toEqual([{ studentId: first.id, outcome: "failed" }]);
    expect(cards.map((card) => card.studentId)).toEqual([second.id]);
  });
});
