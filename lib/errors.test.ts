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

  it("unwrap throws on failures", () => {
    expect(unwrap(ok("x"))).toBe("x");
    expect(() => unwrap(fail("INVALID", "Mal formado."))).toThrow("INVALID");
  });
});
