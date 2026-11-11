import { describe, expect, it } from "vitest";
import { attemptCapabilities, type AttemptSituation } from "./attempt-rules";

const publishAt = new Date("2026-11-10T12:00:00Z");
const dueAt = new Date("2026-11-20T12:00:00Z");
const base: AttemptSituation = {
  status: "opened",
  now: new Date("2026-11-15T12:00:00Z"),
  publishAt,
  dueAt,
  withdrawn: false,
  superseded: false,
};

describe("attemptCapabilities (the attempts table of the spec)", () => {
  it("before publish_at: nothing", () => {
    expect(attemptCapabilities({ ...base, now: new Date("2026-11-09T12:00:00Z") })).toEqual({
      read: "none", saveDraft: false, submit: false, late: false, grade: false,
    });
  });

  it("published and on time, not submitted: read, save and submit; no grading", () => {
    expect(attemptCapabilities({ ...base, status: "started" })).toEqual({
      read: "full", saveDraft: true, submit: true, late: false, grade: false,
    });
  });

  it("after due_at, not submitted: still read, save and submit, marked late", () => {
    expect(attemptCapabilities({ ...base, now: new Date("2026-11-21T12:00:00Z") })).toMatchObject({
      read: "full", saveDraft: true, submit: true, late: true,
    });
  });

  it("submitted: read only, nothing to save or submit, grading open", () => {
    expect(attemptCapabilities({ ...base, status: "submitted" })).toEqual({
      read: "readOnly", saveDraft: false, submit: false, late: false, grade: true,
    });
  });

  it("withdrawn publication: only what was submitted, and grading of it", () => {
    expect(attemptCapabilities({ ...base, status: "submitted", withdrawn: true })).toMatchObject({ read: "submittedOnly", grade: true });
    expect(attemptCapabilities({ ...base, status: "started", withdrawn: true })).toMatchObject({ read: "none", grade: false });
  });

  it("superseded attempt: only what was submitted, and grading of it", () => {
    expect(attemptCapabilities({ ...base, status: "submitted", superseded: true })).toMatchObject({ read: "submittedOnly", grade: true });
    expect(attemptCapabilities({ ...base, superseded: true })).toMatchObject({ read: "none", saveDraft: false });
  });

  it("without dates the task is open and never late", () => {
    expect(attemptCapabilities({ ...base, publishAt: null, dueAt: null })).toMatchObject({ read: "full", late: false });
  });
});
