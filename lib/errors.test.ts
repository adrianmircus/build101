import { describe, expect, it } from "vitest";
import { AppError, fail, isErrorCode, ok, unwrap } from "./errors";

describe("errors", () => {
  it("builds results", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail("NOT_FOUND", "No existe.")).toEqual({ ok: false, code: "NOT_FOUND", message: "No existe." });
  });

  it("recognizes only the expected codes", () => {
    expect(isErrorCode("CONFLICT")).toBe(true);
    expect(isErrorCode("INTERNAL")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it("keeps the code on AppError", () => {
    const error = new AppError("RATE_LIMITED", "Esperá un minuto.");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("RATE_LIMITED");
  });

  it("carries retryAt only when it is given", () => {
    const when = "2026-11-12T15:00:00.000Z";
    expect(new AppError("RATE_LIMITED", "Esperá.", { retryAt: when }).retryAt).toBe(when);
    expect(new AppError("RATE_LIMITED", "Esperá.").retryAt).toBeUndefined();
    expect(new AppError("UNAVAILABLE", "No.", { cause: 3 }).cause).toBe(3);
    expect(fail("RATE_LIMITED", "Esperá.", { retryAt: when })).toEqual({ ok: false, code: "RATE_LIMITED", message: "Esperá.", retryAt: when });
  });

  it("unwrap throws on failures", () => {
    expect(unwrap(ok("x"))).toBe("x");
    expect(() => unwrap(fail("INVALID", "Mal formado."))).toThrow("INVALID");
  });
});
