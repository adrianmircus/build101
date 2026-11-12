import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { rpc: vi.fn() };
const hitRateLimit = vi.fn();
const clearRateLimit = vi.fn();
const revokeSessions = vi.fn();
vi.mock("../../repos/admin/db", () => ({ adminDb: () => db }));
vi.mock("../../repos/admin/rate-limits", () => ({
  hitRateLimit: (...args: unknown[]) => hitRateLimit(...args),
  clearRateLimit: (...args: unknown[]) => clearRateLimit(...args),
}));
vi.mock("../../repos/admin/sessions", () => ({ revokeSessions: (...args: unknown[]) => revokeSessions(...args) }));

import { clearAttempts, hitAttempt } from "./rate-limit";
import { revokeUserSessions } from "./sessions";

beforeEach(() => vi.clearAllMocks());

describe("services/admin: attempts and sessions", () => {
  it("hitAttempt and clearAttempts pass the admin client to the repo and return what it says", async () => {
    hitRateLimit.mockResolvedValue({ allowed: true, retryAt: "x" });
    clearRateLimit.mockResolvedValue({ cleared: 1 });
    await expect(hitAttempt(["k"], [3], 900)).resolves.toEqual({ allowed: true, retryAt: "x" });
    await expect(clearAttempts(["k"])).resolves.toEqual({ cleared: 1 });
    expect(hitRateLimit).toHaveBeenCalledWith(db, { keys: ["k"], limits: [3], windowSeconds: 900 });
    expect(clearRateLimit).toHaveBeenCalledWith(db, ["k"]);
  });

  it("revokeUserSessions passes the admin client and the user", async () => {
    revokeSessions.mockResolvedValue({ revoked: 2 });
    await expect(revokeUserSessions("u1")).resolves.toEqual({ revoked: 2 });
    expect(revokeSessions).toHaveBeenCalledWith(db, "u1");
  });
});
