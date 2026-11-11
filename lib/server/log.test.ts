import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, log, sanitize } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("log", () => {
  it("keeps ids, counts, durations, statuses and the fixed keys", () => {
    const fields = { requestId: "r1", contextId: "c1", inputTokens: 10, outputTokens: 5, promptVersion: "v2", jobCount: 3, latencyMs: 80, httpStatus: 200, entry: "a.b", provider: "x", errorCode: "23505" };
    expect(sanitize(fields)).toEqual(fields);
  });

  it.each(["ip", "nombre", "correo", "telefono", "cedula", "diagnostico", "feedback", "motivo", "reason", "body", "input", "url", "studentName", "prompt", "token"])(
    "drops %s",
    (key) => expect(sanitize({ [key]: "x" })).toEqual({}),
  );

  it("truncates long strings", () => {
    expect(String(sanitize({ errorMessage: "a".repeat(1000) }).errorMessage)).toHaveLength(300);
  });

  it("hides the value Postgres quotes in an enum error", () => {
    const error = Object.assign(new Error('invalid input value for enum profile_kind: "tdah"'), { code: "22P02" });
    expect(describeError(error)).toEqual({ errorType: "Error", errorCode: "22P02", errorMessage: "invalid input value for enum profile_kind: …" });
  });

  it("hides the value Postgres quotes in a uuid error", () => {
    const error = new Error('invalid input syntax for type uuid: "Ana Pérez"');
    expect(describeError(error).errorMessage).toBe("invalid input syntax for type uuid: …");
  });

  it("hides the text JSON.parse quotes, even when it is cut off", () => {
    const error = new SyntaxError(`Unexpected token 'A', "Ana Pérez" is not valid JSON`);
    expect(describeError(error)).toMatchObject({ errorType: "SyntaxError", errorMessage: "Unexpected token …, … is not valid JSON" });
    expect(describeError(new Error("bad near `Ana Pér")).errorMessage).toBe("bad near …");
  });

  it("ignores a code that is not short and structured", () => {
    expect(describeError(Object.assign(new Error("x"), { code: "Ana Pérez dijo que no" }))).toMatchObject({ errorCode: undefined });
  });

  it("does not let a field override level, event or time", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("real.event", { level: "error", event: "fake", time: "never" });
    const line = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "info", event: "real.event" });
    expect(line.time).not.toBe("never");
  });

  it("writes one JSON line per event", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("job.done", { jobId: "j1", prompt: "never logged" });
    const line = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "info", event: "job.done", jobId: "j1" });
    expect(line).not.toHaveProperty("prompt");
  });
});
