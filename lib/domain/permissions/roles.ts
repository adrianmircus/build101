import type { RpcName } from "../rpc";

// The roles of the permissions matrix (docs/PLATAFORMA.md, «Pruebas»). Each one is a fixture the
// matrix test (T1.8) builds against one target group of one institution:
//   admin                admin of the institution, not staff of the target group
//   teacher_of_group     teacher who is staff (owner) of the target group
//   teacher_other_group  teacher of the same institution, staff of another group only
//   inclusion            inclusion team member of the institution
//   student              a student enrolled in the target group (acting on their own data)
//   sandbox_anonymous    the anonymous demo visitor, acting on the target group of their sandbox
//   no_session           no session at all (the publishable key alone)
// A user of another institution is not a column: every operation must deny them (isolation test).

export const MATRIX_ROLES = [
  "admin",
  "teacher_of_group",
  "teacher_other_group",
  "inclusion",
  "student",
  "sandbox_anonymous",
  "no_session",
] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

/**
 * allow: succeeds on the target resource. deny: FORBIDDEN or NOT_FOUND (both leak nothing), or,
 * for a listing, a result without the target. own: allowed only on the caller's own resource
 * (a student's attempt) and denied on anyone else's.
 */
export type Outcome = "allow" | "deny" | "own";

export type Operation = {
  rpc: RpcName;
  /** Phase from which the operation must behave as stated; before it the test skips it. */
  since: number;
  ticket: string;
  access: Readonly<Record<MatrixRole, Outcome>>;
  note?: string;
};

type OperationInput = {
  rpc: RpcName;
  ticket: string;
  allow?: readonly MatrixRole[];
  own?: readonly MatrixRole[];
  since?: number;
  note?: string;
};

/** Everything not listed is denied: the matrix is a list of exceptions to "no". */
export function op({ rpc, ticket, allow = [], own = [], since = 1, note }: OperationInput): Operation {
  const access = denyAll();
  for (const role of allow) access[role] = "allow";
  for (const role of own) access[role] = "own";
  return { rpc, since, ticket, access, ...(note === undefined ? {} : { note }) };
}

function denyAll(): Record<MatrixRole, Outcome> {
  return {
    admin: "deny",
    teacher_of_group: "deny",
    teacher_other_group: "deny",
    inclusion: "deny",
    student: "deny",
    sandbox_anonymous: "deny",
    no_session: "deny",
  };
}
