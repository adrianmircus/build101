import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutOfTheJar } from "../support/cookie-jar";
import { ip, purgeSchools, sessionCookies, watchFetch, withCard } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());
vi.mock("@/lib/server/auth/password-hash", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/auth/password-hash")>("@/lib/server/auth/password-hash");
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { verifyPassword } from "@/lib/server/auth/password-hash";
import { guardAttempt } from "@/lib/server/services/rate-limit";
import { signInStudent } from "@/lib/server/services/student-auth";

// The limits of attempts of T2.7 applied to the login of a student (T2.5b): 10 per IP and pair, 30 per pair from any IP, counted
// before anything is checked, cleared by a success, and a 429 of Auth after a right password counts as a success.

const MIN_MS = 780;

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(() => {
  signOutOfTheJar();
  vi.mocked(verifyPassword).mockClear();
});
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

type Card = Awaited<ReturnType<typeof withCard>>;
const subjectOf = (card: Card) => `${card.login().code}/${card.login().username}`;
const spend = async (count: number, from: string, subject: string) => {
  for (let attempt = 0; attempt < count; attempt += 1) await guardAttempt("student", from, subject);
};

async function timed<T>(work: Promise<T>): Promise<{ elapsed: number; outcome: T | unknown }> {
  const started = Date.now();
  const outcome = await work.catch((thrown: unknown) => thrown);
  return { elapsed: Date.now() - started, outcome };
}

describe("the limit of attempts of the login of a student", () => {
  it("counts before it tries: the eleventh attempt of a pair from one IP is RATE_LIMITED with retryAt and checks nothing", async () => {
    const card = await withCard();
    const from = ip();
    await spend(10, from, subjectOf(card));
    const watch = watchFetch();
    const blocked = await timed(signInStudent(card.login(undefined, from)));
    watch.restore();
    expect(blocked.outcome).toMatchObject({ code: "RATE_LIMITED", retryAt: expect.any(String) });
    expect(blocked.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(vi.mocked(verifyPassword)).not.toHaveBeenCalled();
    // The only thing that went out was the counter itself: no read of the student, no Auth.
    expect(watch.calls).toEqual([expect.objectContaining({ path: expect.stringContaining("/rpc/internal_rate_limit_hit") })]);
    // Another IP has its own pair: the right password gets in.
    expect(await signInStudent(card.login())).toEqual({ next: "/estudiante" });
  });

  it("also limits a user that does not exist: the same pair, the same cap", async () => {
    const { s } = await withCard();
    const from = ip();
    await spend(10, from, `${s.institution.code}/nadie`);
    const blocked = await timed(signInStudent({ code: s.institution.code, username: "nadie", password: "sol-nube-tigre-47", ip: from }));
    expect(blocked.outcome).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("caps one pair at 30 from any IP", async () => {
    const card = await withCard();
    for (let attempt = 0; attempt < 30; attempt += 1) await guardAttempt("student", ip(), subjectOf(card));
    const blocked = await timed(signInStudent(card.login()));
    expect(blocked.outcome).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("a success clears the counters: after it the student starts from zero", async () => {
    const card = await withCard();
    const from = ip();
    await spend(9, from, subjectOf(card));
    expect(await signInStudent(card.login(undefined, from))).toEqual({ next: "/estudiante" });
    signOutOfTheJar();
    await spend(9, from, subjectOf(card));
    expect(await signInStudent(card.login(undefined, from))).toEqual({ next: "/estudiante" });
  });

  it("a 429 of Auth in /verify is «probá en un minuto» and counts as a success: the counters are cleared", async () => {
    const card = await withCard();
    const from = ip();
    await spend(9, from, subjectOf(card));
    const body = JSON.stringify({ code: 429, error_code: "over_request_rate_limit", msg: "limit" });
    const busy = watchFetch((call) => (call.path.startsWith("/auth/v1/verify") ? new Response(body, { status: 429, headers: { "content-type": "application/json" } }) : undefined));
    await expect(signInStudent(card.login(undefined, from))).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Probá de nuevo en un minuto." });
    busy.restore();
    expect(sessionCookies()).toEqual([]);
    // Cleared: nine more attempts fit again (they would not have, with the nine of before).
    await spend(9, from, subjectOf(card));
  });
});
