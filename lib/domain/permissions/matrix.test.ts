import { describe, expect, it } from "vitest";
import { RPC_NAMES, isInternalRpc } from "../rpc";
import { PERMISSIONS, can, operationsFor } from "./matrix";
import { MATRIX_ROLES } from "./roles";
import { APP_TABLES, STUDENT_DATA_TABLES } from "./tables";

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
  it("lists each table once, and student data tables are a subset", () => {
    expect(new Set(APP_TABLES).size).toBe(APP_TABLES.length);
    for (const table of STUDENT_DATA_TABLES) expect(APP_TABLES).toContain(table);
  });
});
