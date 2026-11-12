import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERASURE_RULES } from "./erasure";
import { changedFields, parseInventoryTables } from "./inventory";

// Split from inventory.test.ts (it hit the line limit). T1.F4: the operation of a creation
// (op_key, op_identity) is a hash of the text as it was created. docs/PRIVACIDAD-DATOS.md and
// erasure.ts say the same: an erasure nulls it on assessments, exercises and versions whatever the
// text says now («Para Paula» edited to «Repaso» keeps the hash of «Para Paula»).

const doc = readFileSync(join(__dirname, "..", "..", "..", "docs", "PRIVACIDAD-DATOS.md"), "utf8");
const sections = parseInventoryTables(doc);
const TABLES = [
  ["assessments", "desvincula"],
  ["assessment_exercises", "desvincula"],
  ["versions", "individual: borra; compartida: desvincula"],
] as const;

function identityRow(table: string) {
  return sections.find((item) => item.table === table)?.rows.find((row) => row.fields.includes("op_identity"));
}
function nulledInDoc(table: string): string[] {
  const rows = sections.find((item) => item.table === table)?.rows ?? [];
  return rows.filter((row) => /desvincula$/.test(row.action)).flatMap((row) => row.fields).sort();
}
function withAction(table: string, action: string) {
  return sections.map((item) => ({
    ...item,
    rows: item.table !== table ? item.rows : item.rows.map((row) => (row.fields.includes("op_identity") ? { ...row, action } : row)),
  }));
}

describe("privacy inventory: the operation of a creation (T1.F4)", () => {
  it.each(TABLES)("%s: the doc nulls op_key and op_identity, never decided by the current text", (table, action) => {
    expect(identityRow(table)).toMatchObject({ action, after: "no queda" });
    expect(identityRow(table)?.fields).toContain("op_key");
    expect(identityRow(table)?.why).toContain("Paula");
  });

  it.each(TABLES)("%s: erasure.ts lists the same columns as the doc", (table) => {
    const nullifies: readonly string[] = ERASURE_RULES[table].nullifies ?? [];
    expect([...nullifies].sort()).toEqual(["op_identity", "op_key"]);
    expect(nulledInDoc(table)).toEqual([...nullifies].sort());
  });

  it.each(TABLES)("%s: fails if the doc keeps it or goes back to redacting it only when the text names someone", (table) => {
    for (const wrong of ["conserva", "redacta"]) {
      expect(changedFields(withAction(table, wrong))[`${table}.op_identity`], `${table} ${wrong}`).not.toBe("desvincula");
    }
  });

  it("groups keep theirs: a group name is not personal", () => {
    expect(identityRow("groups")?.action).toBe("conserva");
  });
});
