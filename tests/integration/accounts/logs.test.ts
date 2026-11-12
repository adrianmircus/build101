import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/server/auth/tokens";
import { signOutOfTheJar } from "../support/cookie-jar";
import { asTeacher, authUserOf, credentialOf, ip, issueAgain, jarSessionTokens, ORIGIN, purgeSchools, qrToken, required, scene, watchFetch } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { provisionStudent } from "@/lib/server/services/admin/provisioning";
import { createStudentAccounts, issueAccessCards, previewUsernames } from "@/lib/server/services/student-accounts";
import { readAccessCard, signInStudent } from "@/lib/server/services/student-auth";

// The proof of the criterion «ningún token, hash, contraseña ni usuario en un log»: the flows of the cards and of the login of a
// student run with every console method captured, failures included, and nothing that identifies a student or opens a door may be
// in what was written.

const lines: string[] = [];

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  }
});
afterAll(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

const failing = (work: Promise<unknown>) => work.catch(() => undefined);

describe("what the flows of the student accounts leave in the logs", () => {
  it("runs the cards, the login and the failures, and no secret or student datum is in what was logged", async () => {
    const s = await scene(2);
    const [first, second] = [required(s.students[0]), required(s.students[1])];
    const secrets = [...s.students.flatMap((student) => [student.displayName, student.username]), s.teacher.email, s.teacher.password];

    // Preview and creation of accounts: names and usernames go through them.
    const names = ["Lucía Fernández Prueba", "Martín Núñez Prueba"];
    await previewUsernames({ institutionId: s.institution.id, names });
    await createStudentAccounts({ groupId: s.groupId, rows: [{ displayName: required(names[0]), username: `zz${randomUUID().slice(0, 8)}` }], opKey: randomUUID() });
    secrets.push(...names);

    // Cards for both students, and everything that exists only because of them.
    const { cards } = await issueAccessCards({ groupId: s.groupId, studentIds: [first.id, second.id], opKey: randomUUID(), origin: ORIGIN });
    for (const card of cards) {
      const token = qrToken(card.qrUrl);
      secrets.push(card.password, token, hashToken(token), hashToken(token).slice(2), card.qrUrl);
    }
    for (const student of s.students) secrets.push(required(await credentialOf(student.id)).hash, await authUserOf(student));
    const card = required(cards.find((item) => item.studentId === first.id));

    // Reading the card, bad logins of every kind, a good one, a second card, a repeated request and a reconcile.
    signOutOfTheJar();
    await readAccessCard({ token: qrToken(card.qrUrl), ip: ip() });
    await failing(readAccessCard({ token: "q".repeat(43), ip: ip() }));
    await failing(signInStudent({ code: s.institution.code, username: first.username, password: "sol-nube-tigre-47", ip: ip() }));
    await failing(signInStudent({ code: s.institution.code, username: "nadie", password: "sol-nube-tigre-47", ip: ip() }));
    await failing(signInStudent({ code: "no-existe-este-colegio", username: "nadie", password: "sol-nube-tigre-47", ip: ip() }));
    await signInStudent({ code: s.institution.code, username: first.username, password: card.password, ip: ip() });
    const tokens = await jarSessionTokens();
    secrets.push(tokens.accessToken, tokens.refreshToken);
    await asTeacher(s);
    const repeated = { groupId: s.groupId, studentIds: [second.id], opKey: randomUUID(), origin: ORIGIN };
    await issueAccessCards(repeated);
    await failing(issueAccessCards(repeated));
    await issueAgain(s, second.id);
    // An Auth that does not answer: the provisioning says `uncertain` and logs only that.
    const other = await scene(1);
    const lone = required(other.students[0]);
    const down = watchFetch((call) => (call.path.startsWith("/auth/v1/admin/users") ? new Response("{}", { status: 500 }) : undefined));
    await provisionStudent({ studentId: lone.id, provisioningId: lone.provisioningId });
    down.restore();

    const written = lines.join("\n");
    expect(secrets.length).toBeGreaterThan(10);
    for (const secret of secrets) expect(written).not.toContain(secret);
    // The shape of a password, a token of Supabase and a scrypt hash are not in any line either, whatever they were.
    expect(written).not.toMatch(/\b[a-z]{3,5}-[a-z]{3,5}-[a-z]{3,5}-[2-9]{2}\b/);
    expect(written).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(written).not.toMatch(/scrypt\$/);
  }, 120_000);
});
