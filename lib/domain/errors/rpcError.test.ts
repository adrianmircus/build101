import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGES, REASON_MESSAGES, messageFor } from "./reasons";
import { parseRpcError } from "./rpcError";

describe("parseRpcError", () => {
  it("turns the convention into a code, a reason and the Spanish text for that reason", () => {
    expect(parseRpcError({ code: "P0001", message: "CONFLICT", details: "revision_mismatch" })).toEqual({
      code: "CONFLICT",
      reason: "revision_mismatch",
      message: REASON_MESSAGES.revision_mismatch,
    });
  });

  it("falls back to the code's text for a reason it does not know", () => {
    const parsed = parseRpcError({ code: "P0001", message: "FORBIDDEN", details: "brand_new_reason" });
    expect(parsed).toEqual({ code: "FORBIDDEN", reason: "brand_new_reason", message: DEFAULT_MESSAGES.FORBIDDEN });
  });

  it("never shows a detail that is not a reason key", () => {
    const parsed = parseRpcError({ code: "P0001", message: "INVALID", details: "El estudiante Juan Pérez" });
    expect(parsed?.reason).toBeUndefined();
    expect(parsed?.message).toBe(DEFAULT_MESSAGES.INVALID);
  });

  it("is not an expected error when the message is not a code", () => {
    expect(parseRpcError({ code: "P0001", message: "duplicate for Juan", details: null })).toBeNull();
  });

  it("is not an expected error for other SQLSTATEs", () => {
    expect(parseRpcError({ code: "23505", message: "CONFLICT", details: "revision_mismatch" })).toBeNull();
    expect(parseRpcError({ code: "P0004", message: "lock order violated", details: null })).toBeNull();
    expect(parseRpcError({})).toBeNull();
  });

  it("does not resolve inherited keys as reasons", () => {
    expect(messageFor("NOT_FOUND", "constructor")).toBe(DEFAULT_MESSAGES.NOT_FOUND);
  });

  it("has reason keys with the shape SQL enforces", () => {
    for (const reason of Object.keys(REASON_MESSAGES)) expect(reason).toMatch(/^[a-z][a-z0-9_]{1,62}$/);
  });
});
