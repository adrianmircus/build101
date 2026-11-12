import { redirect } from "next/navigation";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { describe, expect, it } from "vitest";
import { MESSAGES, fail, ok, type Result } from "@/lib/errors";
import { callAction } from "./callAction";

const failing = (error: unknown) => async (): Promise<Result<number>> => {
  throw error;
};

describe("callAction", () => {
  it("returns the action result untouched", async () => {
    expect(await callAction(async (n: number) => ok(n + 1), 1)).toEqual({ ok: true, data: 2 });
  });

  it("lets retryAt reach the screen", async () => {
    const blocked = fail("RATE_LIMITED", "Esperá unos minutos.", { retryAt: "2026-11-12T15:00:00.000Z" });
    expect(await callAction(async () => blocked, undefined)).toEqual(blocked);
  });

  it("answers STALE_CLIENT for an action the new build no longer has", async () => {
    const result = await callAction(failing(new UnrecognizedActionError("gone")), undefined);
    expect(result).toMatchObject({ ok: false, code: "STALE_CLIENT", message: MESSAGES.STALE_CLIENT });
  });

  it("lets redirect() reach Next instead of turning it into a failure", async () => {
    const thrown = (() => {
      try {
        redirect("/panel");
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeDefined();
    await expect(callAction(failing(thrown), undefined)).rejects.toBe(thrown);
  });

  it("answers UNAVAILABLE when the network drops", async () => {
    const result = await callAction(failing(new TypeError("Failed to fetch")), undefined);
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("answers INTERNAL for any other error", async () => {
    const result = await callAction(failing(new Error("boom")), undefined);
    expect(result).toMatchObject({ ok: false, code: "INTERNAL", message: MESSAGES.INTERNAL });
  });
});
