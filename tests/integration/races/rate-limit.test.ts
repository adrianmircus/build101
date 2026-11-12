import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { guardAttempt } from "@/lib/server/services/rate-limit";
import { countRows } from "../support/db";
import { stampede } from "../support/race";
import { SERVICE } from "../support/world";

// F2C-11: the attempts are counted in ONE statement before they are tried, so a burst of concurrent attempts on the same
// subject lets through at most the cap. 50 at once, on 50 connections (SQL) and through the service (PostgREST).

const ATTEMPTS = 50;

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "race-test-secret-".padEnd(40, "x");
});

const keyOf = (seed: string) => `staff_pair:${createHash("sha256").update(seed).digest("hex")}`;

describe("race: 50 concurrent attempts on one subject", () => {
  it("the RPC lets through exactly the cap, on 50 connections at once", async () => {
    const key = keyOf(randomUUID());
    const cap = 10;
    const outcomes = await stampede(
      Array.from({ length: ATTEMPTS }, () => ({ actor: SERVICE, rpc: "internal_rate_limit_hit", args: { p_keys: [key], p_limits: [String(cap)], p_window_seconds: 900 } })),
    );
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const allowed = outcomes.filter((outcome) => outcome.ok && outcome.value.allowed === true);
    expect(allowed.length).toBe(cap);
    // Every attempt counted, the blocked ones too: nothing was lost to the race.
    expect(await countRows("select sum(count)::text as n from app.rate_limits where key = $1", [key])).toBe(ATTEMPTS);
  });

  it("two keys in each call: the cap of each one holds, and no call deadlocks", async () => {
    const [a, b] = [keyOf(randomUUID()), keyOf(randomUUID())];
    const outcomes = await stampede(
      Array.from({ length: ATTEMPTS }, (_, index) => ({
        actor: SERVICE,
        rpc: "internal_rate_limit_hit",
        args: { p_keys: index % 2 === 0 ? [a, b] : [b, a], p_limits: index % 2 === 0 ? ["20", "30"] : ["30", "20"], p_window_seconds: 900 },
      })),
    );
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(await countRows("select sum(count)::text as n from app.rate_limits where key = $1", [a])).toBe(ATTEMPTS);
    expect(await countRows("select sum(count)::text as n from app.rate_limits where key = $1", [b])).toBe(ATTEMPTS);
  });

  it("guardAttempt: of 50 students typing at once from one place, at most 10 get to try (the cap of the pair)", async () => {
    const subject = `liceo/${randomUUID()}`;
    const results = await Promise.allSettled(Array.from({ length: ATTEMPTS }, () => guardAttempt("student", "203.0.113.9", subject)));
    const passed = results.filter((result) => result.status === "fulfilled").length;
    const blocked = results.filter((result) => result.status === "rejected" && result.reason instanceof AppError && result.reason.code === "RATE_LIMITED");
    expect(passed).toBeLessThanOrEqual(10);
    expect(passed + blocked.length).toBe(ATTEMPTS);
    const first = blocked[0];
    expect(first?.status === "rejected" && first.reason instanceof AppError && first.reason.retryAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("guardAttempt: spread over 50 different IPs, the cap per subject (30) holds", async () => {
    const subject = `liceo/${randomUUID()}`;
    const results = await Promise.allSettled(Array.from({ length: ATTEMPTS }, (_, index) => guardAttempt("student", `198.51.100.${index + 1}`, subject)));
    expect(results.filter((result) => result.status === "fulfilled").length).toBeLessThanOrEqual(30);
  });
});
