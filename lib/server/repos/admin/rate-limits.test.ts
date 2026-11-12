import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { RpcBuilder, RpcDb } from "../rpc";
import { clearRateLimit, hitRateLimit } from "./rate-limits";
import { revokeSessions } from "./sessions";

const KEY = `staff_pair:${"a".repeat(64)}`;
const USER = "11111111-1111-4111-8111-111111111111";

function fakeDb(reply: { data: unknown; error: { code?: string; message?: string; details?: string } | null }) {
  const calls: { name: string; args: unknown }[] = [];
  const db: RpcDb = {
    rpc(name, args) {
      calls.push({ name, args });
      const builder: RpcBuilder = { then: (ok, no) => Promise.resolve(reply).then(ok, no), setHeader: () => builder };
      return builder;
    },
  };
  return { db, calls };
}

describe("repos of the admin: attempts and sessions", () => {
  it("hitRateLimit sends the three arguments and parses {allowed, retryAt}", async () => {
    const { db, calls } = fakeDb({ data: { allowed: false, retryAt: "2026-11-12T15:00:00+00:00" }, error: null });
    await expect(hitRateLimit(db, { keys: [KEY], limits: [10], windowSeconds: 900 })).resolves.toEqual({ allowed: false, retryAt: "2026-11-12T15:00:00+00:00" });
    expect(calls).toEqual([{ name: "internal_rate_limit_hit", args: { p_keys: [KEY], p_limits: [10], p_window_seconds: 900 } }]);
  });

  it("refuses a key that is not bucket:hex before calling (an email never gets to the database)", async () => {
    const { db, calls } = fakeDb({ data: { allowed: true, retryAt: "2026-11-12T15:00:00+00:00" }, error: null });
    await expect(hitRateLimit(db, { keys: ["juan@example.com"], limits: [10], windowSeconds: 900 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("clearRateLimit and revokeSessions call their RPCs", async () => {
    const cleared = fakeDb({ data: { cleared: 2 }, error: null });
    await expect(clearRateLimit(cleared.db, [KEY])).resolves.toEqual({ cleared: 2 });
    expect(cleared.calls[0]).toEqual({ name: "internal_rate_limit_clear", args: { p_keys: [KEY] } });
    const revoked = fakeDb({ data: { revoked: 3 }, error: null });
    await expect(revokeSessions(revoked.db, USER)).resolves.toEqual({ revoked: 3 });
    expect(revoked.calls[0]).toEqual({ name: "internal_revoke_user_sessions", args: { p_user_id: USER } });
  });

  it("an answer that does not match its schema is an error, not a pass", async () => {
    const { db } = fakeDb({ data: { allowed: "yes" }, error: null });
    await expect(hitRateLimit(db, { keys: [KEY], limits: [10], windowSeconds: 900 })).rejects.toThrow();
  });

  it("a FORBIDDEN no_session of the database reaches the caller as AppError", async () => {
    const { db } = fakeDb({ data: null, error: { code: "P0001", message: "FORBIDDEN", details: "no_session" } });
    await expect(revokeSessions(db, USER)).rejects.toBeInstanceOf(AppError);
  });
});
