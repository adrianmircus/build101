import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { SAFE_ERROR_MESSAGES, describeError, firstOwnFrame, log, sanitize } from "./log";

function realJsonError(text: string): Error {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("JSON.parse should have failed");
}

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

  const lineFor = (error: unknown): string => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("x.failed", { requestId: "r1", ...describeError(error) });
    return String(spy.mock.calls[0]?.[0]);
  };

  it.each([
    ["unquoted student data", new Error("estudiante Ana Pérez: perfil tdah"), ["Ana", "Pérez", "tdah", "estudiante"]],
    ["a real JSON.parse error", realJsonError("Ana Pérez tdah"), ["Ana", "Pérez", "tdah"]],
    ["a Postgres-style error", Object.assign(new Error("invalid input value for enum profile_kind: tdah"), { code: "22P02" }), ["profile_kind", "tdah", "enum"]],
  ])("leaves no fragment of the message for %s", (_name, error, fragments) => {
    const line = lineFor(error);
    for (const fragment of fragments) expect(line).not.toContain(fragment);
    expect(JSON.parse(line)).not.toHaveProperty("errorMessage");
  });

  it("keeps type and structured code of a Postgres-style error", () => {
    const error = Object.assign(new Error("duplicate key tdah"), { code: "23505" });
    expect(describeError(error)).toMatchObject({ errorType: "Error", errorCode: "23505", errorMessage: undefined });
  });

  it("keeps the message of an AppError and of a known safe message", () => {
    expect(describeError(new AppError("FORBIDDEN", "No tenés acceso a este grupo."))).toMatchObject({ errorMessage: "No tenés acceso a este grupo." });
    SAFE_ERROR_MESSAGES.add("known safe text");
    expect(describeError(new Error("known safe text"))).toMatchObject({ errorMessage: "known safe text" });
    SAFE_ERROR_MESSAGES.delete("known safe text");
  });

  it("points errorFrame at one of our files, with no message text", () => {
    const frame = String(describeError(new Error("estudiante Ana Pérez")).errorFrame);
    expect(frame).toMatch(/^lib\/server\/log\.test\.ts:\d+$/);
    expect(sanitize({ errorFrame: frame })).toEqual({ errorFrame: frame });
  });

  it("skips frames from node_modules and node: and gives none when only those exist", () => {
    const error = new Error("m");
    error.stack = "Error: m\n    at a (node:internal/x:1:1)\n    at b (/app/node_modules/zod/index.js:2:2)";
    expect(firstOwnFrame(error)).toBeUndefined();
  });

  it("does not take a frame from a message that imitates a stack", () => {
    const error = new Error("hola\n    at x (Ana Pérez:1:1)");
    expect(String(firstOwnFrame(error))).toMatch(/^lib\/server\/log\.test\.ts:\d+$/);
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
