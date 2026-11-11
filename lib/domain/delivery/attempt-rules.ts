import type { AttemptStatus } from "./entities";

// What can be done with an attempt at a given moment («Qué se puede hacer con cada intento» in
// docs/PLATAFORMA.md). The RPCs enforce the same table in SQL (T1.5b, T1.5c); this pure version
// lets the UI show the right buttons and lets tests state the table once.

export type AttemptSituation = {
  status: AttemptStatus;
  now: Date;
  publishAt: Date | null;
  dueAt: Date | null;
  withdrawn: boolean;
  superseded: boolean;
};

/** none: not visible yet; full: the task to solve; readOnly: what was submitted, frozen. */
export type ReadAccess = "none" | "full" | "readOnly" | "submittedOnly";

export type AttemptCapabilities = {
  read: ReadAccess;
  saveDraft: boolean;
  submit: boolean;
  /** Submitting now would be marked late. */
  late: boolean;
  grade: boolean;
};

const CLOSED: AttemptCapabilities = { read: "none", saveDraft: false, submit: false, late: false, grade: false };

export function attemptCapabilities(situation: AttemptSituation): AttemptCapabilities {
  const submitted = situation.status === "submitted";
  // A withdrawn publication or a superseded attempt only shows what was already submitted.
  if (situation.withdrawn || situation.superseded) {
    return { ...CLOSED, read: submitted ? "submittedOnly" : "none", grade: submitted };
  }
  if (situation.publishAt !== null && situation.now < situation.publishAt) return CLOSED;
  // Submitted: read only; submitting again changes nothing; grading opens right away.
  if (submitted) return { ...CLOSED, read: "readOnly", grade: true };
  const late = situation.dueAt !== null && situation.now > situation.dueAt;
  return { read: "full", saveDraft: true, submit: true, late, grade: false };
}
