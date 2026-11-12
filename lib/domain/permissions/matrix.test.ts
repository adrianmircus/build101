import { describe, expect, it } from "vitest";
import { RPC_NAMES, isInternalRpc } from "../rpc";
import { PERMISSIONS, can, operationsFor } from "./matrix";
import { MATRIX_ROLES } from "./roles";
import { ERASURE_RULES, STUDENT_DATA_TABLES } from "./erasure";
import { APP_TABLES } from "./tables";

describe("permissions matrix", () => {
  it("has exactly one row per RPC of the contract", () => {
    const rows = PERMISSIONS.map((operation) => operation.rpc);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...rows].sort()).toEqual([...RPC_NAMES].sort());
  });

  it("gives every role an outcome in every row", () => {
    for (const operation of PERMISSIONS) expect(Object.keys(operation.access).sort()).toEqual([...MATRIX_ROLES].sort());
  });

  it("never lets a user role run an internal RPC", () => {
    for (const operation of PERMISSIONS.filter((row) => isInternalRpc(row.rpc))) {
      for (const role of MATRIX_ROLES) expect(operation.access[role], `${operation.rpc} as ${role}`).toBe("deny");
    }
  });

  it("denies everything without a session", () => {
    for (const operation of PERMISSIONS) expect(operation.access.no_session, operation.rpc).toBe("deny");
  });

  it("keeps sensitive data away from a teacher of another group and from students", () => {
    const sensitive = ["get_student_needs", "get_group_needs", "list_student_notes", "get_version", "get_attempt_for_grading"];
    for (const rpc of sensitive) {
      expect(can(rpc, "teacher_other_group", 1), rpc).toBe(false);
      expect(can(rpc, "student", 1), rpc).toBe(false);
    }
  });

  it("lets a student act only on their own data", () => {
    for (const operation of PERMISSIONS) expect(["deny", "own"], operation.rpc).toContain(operation.access.student);
  });

  it("applies each operation from its phase on", () => {
    expect(can("publish_version", "teacher_of_group", 0)).toBe(false);
    expect(can("publish_version", "teacher_of_group", 1)).toBe(true);
    expect(operationsFor(0)).toEqual([]);
    expect(operationsFor(1)).toHaveLength(PERMISSIONS.length);
    expect(can("not_an_rpc", "admin", 9)).toBe(false);
  });
});

describe("tables", () => {
  it("lists each table once", () => {
    expect(new Set(APP_TABLES).size).toBe(APP_TABLES.length);
  });

  it("gives an erasure rule, with its reason, to every table with data about a student", () => {
    expect(STUDENT_DATA_TABLES).toHaveLength(Object.keys(ERASURE_RULES).length);
    for (const entry of Object.values(ERASURE_RULES)) expect(entry.why.length).toBeGreaterThan(5);
    // Derived from a profile, so they must be there (adapted texts, raw outputs, keys).
    const derived = ["version_exercises", "version_questions", "question_keys", "generation_outputs", "answer_keys", "answer_key_revisions", "operations"];
    for (const table of derived) expect(STUDENT_DATA_TABLES, table).toContain(table);
  });
});
