import type { Failure } from "@/lib/errors";

// How a failed action looks to a student: always neutral. Whether the school, the user or the password was wrong is
// never told apart (the server answers the same), and a failure on our side is never the student's fault.

export type Field = "code" | "username" | "password";

export type Notice =
  | { kind: "wrong" }
  | { kind: "missing"; field: Field }
  | { kind: "unavailable" }
  | { kind: "stale" };

export type FailureView = { kind: "pause"; retryAt: string | undefined } | { kind: "notice"; notice: Notice };

export function viewOfFailure(failure: Failure): FailureView {
  switch (failure.code) {
    case "RATE_LIMITED":
      return { kind: "pause", retryAt: failure.retryAt };
    case "UNAVAILABLE":
    case "INTERNAL":
      return { kind: "notice", notice: { kind: "unavailable" } };
    case "STALE_CLIENT":
      return { kind: "notice", notice: { kind: "stale" } };
    default:
      return { kind: "notice", notice: { kind: "wrong" } };
  }
}
