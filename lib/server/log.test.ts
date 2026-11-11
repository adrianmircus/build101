import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, log, sanitize } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("log", () => {
  it("drops keys that look like personal data", () => {
    const out = sanitize({ studentName: "Paula", email: "p@x.uy", answerText: "x=2", jobId: "j1", count: 3 });
    expect(out).toEqual({ jobId: "j1", count: 3 });
  });

  it("truncates long strings", () => {
    expect(String(sanitize({ detail: "a".repeat(1000) }).detail)).toHaveLength(300);
  });

  it("describes errors by type and message, keeping both after sanitizing", () => {
    expect(sanitize(describeError(new TypeError("boom")))).toEqual({ errorType: "TypeError", errorMessage: "boom" });
  });

  it("writes one JSON line per event", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("job.done", { jobId: "j1", prompt: "never logged" });
    const line = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "info", event: "job.done", jobId: "j1" });
    expect(line).not.toHaveProperty("prompt");
  });
});
