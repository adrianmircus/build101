import { describe, expect, it } from "vitest";
import { attemptCapabilities, type AttemptCapabilities, type AttemptSituation } from "./attempt-rules";
import type { AttemptStatus } from "./entities";

// Every status crossed with every moment: the spec's table, with starting as its own step.
const publishAt = new Date("2026-11-10T12:00:00Z");
const dueAt = new Date("2026-11-20T12:00:00Z");

type Moment = "beforePublish" | "onTime" | "late" | "withdrawn" | "superseded";

const MOMENTS: Record<Moment, Omit<AttemptSituation, "status">> = {
  beforePublish: { now: new Date("2026-11-09T12:00:00Z"), publishAt, dueAt, withdrawn: false, superseded: false },
  onTime: { now: new Date("2026-11-15T12:00:00Z"), publishAt, dueAt, withdrawn: false, superseded: false },
  late: { now: new Date("2026-11-21T12:00:00Z"), publishAt, dueAt, withdrawn: false, superseded: false },
  withdrawn: { now: new Date("2026-11-15T12:00:00Z"), publishAt, dueAt, withdrawn: true, superseded: false },
  superseded: { now: new Date("2026-11-15T12:00:00Z"), publishAt, dueAt, withdrawn: false, superseded: true },
};

const NONE: AttemptCapabilities = { read: "none", start: false, saveDraft: false, submit: false, late: false, grade: false };
const can = (extra: Partial<AttemptCapabilities>): AttemptCapabilities => ({ ...NONE, ...extra });

const EXPECTED: Record<AttemptStatus, Record<Moment, AttemptCapabilities>> = {
  opened: {
    beforePublish: NONE,
    onTime: can({ read: "full", start: true }),
    late: can({ read: "full", start: true, late: true }),
    withdrawn: NONE,
    superseded: NONE,
  },
  started: {
    beforePublish: NONE,
    onTime: can({ read: "full", saveDraft: true, submit: true }),
    late: can({ read: "full", saveDraft: true, submit: true, late: true }),
    withdrawn: NONE,
    superseded: NONE,
  },
  submitted: {
    beforePublish: NONE,
    onTime: can({ read: "readOnly", grade: true }),
    late: can({ read: "readOnly", grade: true }),
    withdrawn: can({ read: "submittedOnly", grade: true }),
    superseded: can({ read: "submittedOnly", grade: true }),
  },
};

describe("attemptCapabilities", () => {
  const statuses = ["opened", "started", "submitted"] as const;
  const moments = ["beforePublish", "onTime", "late", "withdrawn", "superseded"] as const;
  for (const status of statuses) {
    for (const moment of moments) {
      it(`${status} / ${moment}`, () => {
        expect(attemptCapabilities({ ...MOMENTS[moment], status })).toEqual(EXPECTED[status][moment]);
      });
    }
  }

  it("only a started attempt can save or submit", () => {
    for (const situation of Object.values(MOMENTS)) {
      for (const status of ["opened", "submitted"] as const) {
        const result = attemptCapabilities({ ...situation, status });
        expect(result.saveDraft || result.submit).toBe(false);
      }
    }
  });

  it("without dates the task is open and never late", () => {
    const open = { ...MOMENTS.onTime, publishAt: null, dueAt: null };
    expect(attemptCapabilities({ ...open, status: "started" })).toEqual(can({ read: "full", saveDraft: true, submit: true }));
  });
});
