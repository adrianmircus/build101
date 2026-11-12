import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

const hitAttempt = vi.fn();
const clearAttempts = vi.fn();
vi.mock("./admin/rate-limit", () => ({ hitAttempt: (...args: unknown[]) => hitAttempt(...args), clearAttempts: (...args: unknown[]) => clearAttempts(...args) }));

import { clearSubject, guardAttempt } from "./rate-limit";

const SECRET = "s".repeat(40);
const hmac = (bucket: string, value: string) => `${bucket}:${createHmac("sha256", SECRET).update(value).digest("hex")}`;
const keysOf = (call: number): string[] => {
  const value: unknown = hitAttempt.mock.calls[call]?.[0];
  return Array.isArray(value) ? value.map(String) : [];
};
const FREE = { allowed: true, retryAt: "2026-11-12T15:00:00+00:00" };

beforeEach(() => {
  process.env.RATE_LIMIT_SECRET = SECRET;
  hitAttempt.mockResolvedValue(FREE);
  clearAttempts.mockResolvedValue({ cleared: 1 });
});
afterEach(() => {
  vi.restoreAllMocks();
  hitAttempt.mockReset();
  clearAttempts.mockReset();
  delete process.env.RATE_LIMIT_SECRET;
});

describe("guardAttempt: keys and caps of the contract", () => {
  it("student: pair 10 and subject 30 in 15 minutes, as <bucket>:<hmac hex>", async () => {
    await guardAttempt("student", "203.0.113.7", "Liceo-1/Ana.Perez ");
    expect(hitAttempt).toHaveBeenCalledWith(
      [hmac("student_pair", "203.0.113.7|liceo-1/ana.perez"), hmac("student_subject", "liceo-1/ana.perez")],
      [10, 30],
      900,
    );
  });

  it("staff: pair 10 and subject 30 by normalized email", async () => {
    await guardAttempt("staff", "203.0.113.7", " Profe@Colegio.EDU.uy");
    expect(hitAttempt).toHaveBeenCalledWith(
      [hmac("staff_pair", "203.0.113.7|profe@colegio.edu.uy"), hmac("staff_subject", "profe@colegio.edu.uy")],
      [10, 30],
      900,
    );
  });

  it("reset: 3 per email and 20 per IP, in one hour", async () => {
    await guardAttempt("reset", "203.0.113.7", "profe@colegio.edu.uy");
    expect(hitAttempt).toHaveBeenCalledWith([hmac("reset_email", "profe@colegio.edu.uy"), hmac("reset_ip", "203.0.113.7")], [3, 20], 3600);
  });

  it("token: 30 per IP in 15 minutes, no subject", async () => {
    await guardAttempt("token", "203.0.113.7", null);
    expect(hitAttempt).toHaveBeenCalledWith([hmac("token_ip", "203.0.113.7")], [30], 900);
  });

  it("never puts the IP, the subject or the secret in a key", async () => {
    await guardAttempt("student", "203.0.113.7", "liceo/ana");
    for (const key of keysOf(0)) {
      expect(key).toMatch(/^[a-z_]+:[0-9a-f]{64}$/);
      expect(key).not.toMatch(/203|ana|liceo/);
    }
  });

  it("the same subject written with another case or spaces is the same key", async () => {
    await guardAttempt("staff", "1.1.1.1", "A@b.com");
    await guardAttempt("staff", "1.1.1.1", "  a@B.COM ");
    expect(keysOf(0)).toEqual(keysOf(1));
  });

  it("a different IP changes the pair and not the subject key", async () => {
    await guardAttempt("student", "1.1.1.1", "x/y");
    await guardAttempt("student", "2.2.2.2", "x/y");
    expect(keysOf(0)[0]).not.toBe(keysOf(1)[0]);
    expect(keysOf(0)[1]).toBe(keysOf(1)[1]);
  });
});

describe("guardAttempt: the answer", () => {
  it("lets it through when it is allowed", async () => {
    await expect(guardAttempt("staff", "1.1.1.1", "a@b.com")).resolves.toBeUndefined();
  });

  it("throws RATE_LIMITED with retryAt in ISO 8601 when a counter is over", async () => {
    hitAttempt.mockResolvedValue({ allowed: false, retryAt: "2026-11-12T15:00:00+00:00" });
    const error = await guardAttempt("staff", "1.1.1.1", "a@b.com").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryAt: "2026-11-12T15:00:00.000Z" });
    expect(error instanceof AppError && error.message).toMatch(/intentos/);
  });

  it("lets a failure of the database go up: no counter, no attempt", async () => {
    hitAttempt.mockRejectedValue(new Error("db caída"));
    await expect(guardAttempt("staff", "1.1.1.1", "a@b.com")).rejects.toThrow("db caída");
  });

  it("without RATE_LIMIT_SECRET (or with a short one) it counts nothing and refuses", async () => {
    delete process.env.RATE_LIMIT_SECRET;
    await expect(guardAttempt("token", "1.1.1.1", null)).rejects.toThrow(/RATE_LIMIT_SECRET/);
    process.env.RATE_LIMIT_SECRET = "corto";
    await expect(guardAttempt("token", "1.1.1.1", null)).rejects.toThrow(/RATE_LIMIT_SECRET/);
    expect(hitAttempt).not.toHaveBeenCalled();
  });

  it("a kind that needs a subject refuses to run without one", async () => {
    await expect(guardAttempt("student", "1.1.1.1", null)).rejects.toThrow();
    expect(hitAttempt).not.toHaveBeenCalled();
  });
});

describe("clearSubject", () => {
  it("clears the subject counters, and the pair too when it is given the IP", async () => {
    await clearSubject("student", "Liceo/Ana", "1.1.1.1");
    expect(clearAttempts).toHaveBeenCalledWith([hmac("student_pair", "1.1.1.1|liceo/ana"), hmac("student_subject", "liceo/ana")]);
  });

  it("without the IP it clears only the subject counter", async () => {
    await clearSubject("staff", "a@b.com");
    expect(clearAttempts).toHaveBeenCalledWith([hmac("staff_subject", "a@b.com")]);
  });

  it("never clears the counters of the IP alone", async () => {
    await clearSubject("reset", "a@b.com", "1.1.1.1");
    expect(clearAttempts).toHaveBeenCalledWith([hmac("reset_email", "a@b.com")]);
    clearAttempts.mockClear();
    await clearSubject("token", "x");
    expect(clearAttempts).not.toHaveBeenCalled();
  });
});
