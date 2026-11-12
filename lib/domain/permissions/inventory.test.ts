import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERASURE_RULES, STUDENT_DATA_TABLES } from "./erasure";
import { changedFields, documentedColumns, parseInventoryTables, parseSqlColumnList, parseSqlTableList, sliceBetween, type InventorySection } from "./inventory";
import { APP_TABLES } from "./tables";

// docs/PRIVACIDAD-DATOS.md (T1.9) against the schema, erasure.ts and the database test's literal list.

const root = join(__dirname, "..", "..", "..");
const doc = readFileSync(join(root, "docs", "PRIVACIDAD-DATOS.md"), "utf8");
const sqlTest = readFileSync(join(root, "supabase", "tests", "006_inventory.test.sql"), "utf8");
const sections = parseInventoryTables(doc);
const byTable = new Map(sections.map((item) => [item.table, item]));
const studentTables = new Set<string>(STUDENT_DATA_TABLES);
const NOT_IN_ERASURE: string[] = ["sin datos de estudiantes"];
const PROVIDERS = ["Supabase", "Netlify", "Anthropic", "OpenRouter", "ElevenLabs", "Resend", "Sentry", "Cloudflare", "Dictado del navegador"];
// JSON columns that must be explained field by field.
const JSON_FIELDS: Record<string, string[]> = {
  generations: ["inputs"],
  generation_outputs: ["output"],
  version_events: ["data", "result"],
  operations: ["merge_result"],
  group_analyses: ["result", "pseudonym_map"],
  import_runs: ["id_map"],
  feedback_events: ["data"],
  submissions: ["answers", "choices"],
};
// The one field per table that erasure mode lets through (20261111130800_platform.sql).
const REDACTABLE: Record<string, string[]> = {
  version_events: ["data", "result"],
  generation_outputs: ["output"],
  answer_key_revisions: ["content"],
  publications: ["content"],
  generations: ["inputs"],
};

// Exactly which fields are unlinked or redacted (for tables that follow a version, in a shared one).
const CHANGED: Record<string, string> = {
  "student_pseudonyms.student_id": "desvincula",
  "account_provisioning.student_id": "desvincula",
  "account_provisioning.op_identity": "desvincula",
  "versions.config": "redacta",
  "versions.general_instructions": "redacta",
  "version_exercises.body": "redacta",
  "version_exercises.changes": "redacta",
  "version_questions.stem": "redacta",
  "version_questions.options": "redacta",
  "generations.inputs": "redacta",
  "generation_outputs.output": "redacta",
  "version_events.data": "redacta",
  "version_events.result": "redacta",
  "answer_key_revisions.content": "redacta",
  "publications.content": "redacta",
  "operations.merge_result": "redacta",
  "group_analyses.pseudonym_map": "redacta",
  "group_analyses.result": "redacta",
  "assessment_exercises.body": "redacta",
  "assessment_exercises.label": "redacta",
  "assessments.topic": "redacta",
  "assessments.general_instructions": "redacta",
  // T1.F4: the identity of a creation is a hash of the text as it was created; both go to null whatever the text says now.
  "assessments.op_key": "desvincula",
  "assessments.op_identity": "desvincula",
  "assessment_exercises.op_key": "desvincula",
  "assessment_exercises.op_identity": "desvincula",
  "versions.op_key": "desvincula",
  "versions.op_identity": "desvincula",
  "presets.name": "redacta",
  "presets.config": "redacta",
  "import_runs.id_map": "redacta",
};

function swap(source: InventorySection[], edit: { table: string; field: string; action: string }): InventorySection[] {
  return source.map((item) => ({
    ...item,
    rows: item.table !== edit.table ? item.rows : item.rows.map((row) => (row.fields.includes(edit.field) ? { ...row, action: edit.action } : row)),
  }));
}
function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("privacy inventory: tables", () => {
  it("lists the same tables as the SQL list, APP_TABLES and the doc", () => {
    const inDoc = sections.map((item) => item.table);
    const inSql = parseSqlTableList(sqlTest);
    expect(new Set(inDoc).size, "a table appears twice in the doc").toBe(inDoc.length);
    expect(new Set(inSql).size, "a table appears twice in the SQL list").toBe(inSql.length);
    expect(sorted(inDoc)).toEqual(sorted(APP_TABLES));
    expect(sorted(inSql)).toEqual(sorted(APP_TABLES));
  });

  it("gives each student table the rule of erasure.ts", () => {
    expect(sorted(Object.keys(ERASURE_RULES))).toEqual(sorted(STUDENT_DATA_TABLES));
    for (const [table, entry] of Object.entries(ERASURE_RULES)) expect(byTable.get(table)?.rule, table).toBe(entry.rule);
  });

  it("marks every other table as without student data", () => {
    for (const item of sections.filter((row) => !studentTables.has(row.table))) expect(NOT_IN_ERASURE, item.table).toContain(item.rule);
  });
});

describe("privacy inventory: fields", () => {
  it("lists exactly the columns the database has, once each", () => {
    const real = parseSqlColumnList(sqlTest);
    const documented = documentedColumns(sections);
    expect(new Set(real).size, "a column appears twice in the SQL list").toBe(real.length);
    expect(new Set(documented).size, "a field appears twice in the doc").toBe(documented.length);
    expect(sorted(documented)).toEqual(sorted(real));
  });

  it("fails when a column exists without being documented, or the other way around", () => {
    const real = parseSqlColumnList(sqlTest);
    const documented = documentedColumns(sections);
    expect(sorted(documented)).not.toEqual(sorted([...real, "students.undocumented_personal_data"]));
    expect(sorted(real)).not.toEqual(sorted([...documented, "students.invented"]));
    const without = documented.filter((column) => column !== "student_needs.interests");
    expect(sorted(without)).not.toEqual(sorted(real));
  });
  it("explains every JSON column", () => {
    for (const [table, fields] of Object.entries(JSON_FIELDS)) {
      for (const field of fields) {
        const row = byTable.get(table)?.rows.find((item) => item.fields.includes(field));
        expect(row, `${table}.${field}`).toBeDefined();
        expect(row?.why.length ?? 0, `${table}.${field} needs its content explained`).toBeGreaterThan(40);
        expect(row?.why, `${table}.${field} names the JSON`).toContain("JSON");
      }
    }
  });

  it("uses only known actions and outcomes, and what goes is never left behind", () => {
    const action = "(borra|redacta|conserva|desvincula)";
    const valid = new RegExp(`^${action}$|^individual: ${action}; compartida: ${action}$`);
    for (const item of sections) {
      expect(item.rows.length, item.table).toBeGreaterThan(0);
      for (const row of item.rows) {
        const where = `${item.table}.${row.fields.join(",")}`;
        expect(row.action, where).toMatch(valid);
        expect(["no queda", "personal", "no personal"], where).toContain(row.after);
        expect(row.why.length, `${where} needs a reason`).toBeGreaterThan(5);
        const goes = /(^|compartida: )(borra|desvincula)$/.test(row.action);
        expect(row.after === "no queda", `${where}: ${row.action} / ${row.after}`).toBe(goes);
        const justified = row.after !== "no personal" || goes || !studentTables.has(item.table) || row.why.length > 20;
        expect(justified, `${where}: "no personal" needs a justification`).toBe(true);
      }
    }
  });

  it("unlinks and redacts exactly the expected fields", () => {
    expect(changedFields(sections)).toEqual(CHANGED);
  });

  it("fails when an action moves to another field or a shared field is kept", () => {
    const moved = swap(swap(sections, { table: "student_pseudonyms", field: "student_id", action: "conserva" }), { table: "student_pseudonyms", field: "id", action: "desvincula" });
    expect(changedFields(moved)).not.toEqual(CHANGED);
    expect(changedFields(swap(sections, { table: "version_questions", field: "stem", action: "individual: borra; compartida: conserva" }))).not.toEqual(CHANGED);
    expect(changedFields(swap(sections, { table: "versions", field: "config", action: "individual: borra; compartida: conserva" }))).not.toEqual(CHANGED);
    expect(changedFields(swap(sections, { table: "account_provisioning", field: "student_id", action: "conserva" }))).not.toEqual(CHANGED);
  });

  it("nulls account_provisioning.op_identity on erasure, and fails if it is kept (N1)", () => {
    const nullified = ERASURE_RULES.account_provisioning.nullifies;
    expect(nullified).toContain("op_identity");
    const row = byTable.get("account_provisioning")?.rows.find((item) => item.fields.includes("op_identity"));
    expect(row).toMatchObject({ action: "desvincula", after: "no queda" });
    // The doc and erasure.ts agree on every nulled column of the table.
    const inDoc = (byTable.get("account_provisioning")?.rows ?? []).filter((item) => item.action === "desvincula").flatMap((item) => item.fields);
    expect(sorted(inDoc)).toEqual(sorted(nullified));
    // Negative: if the doc kept it as "no personal", it no longer matches the rule.
    const kept = swap(sections, { table: "account_provisioning", field: "op_identity", action: "conserva" });
    expect(changedFields(kept)["account_provisioning.op_identity"]).toBeUndefined();
    expect(changedFields(kept)).not.toEqual(CHANGED);
  });

  it("matches each rule with what its fields do", () => {
    for (const [table, entry] of Object.entries(ERASURE_RULES)) {
      const actions = (byTable.get(table)?.rows ?? []).map((row) => row.action);
      if (entry.rule === "delete") expect(actions.every((item) => item === "borra"), `${table} deletes every field`).toBe(true);
      if (entry.rule === "by_version") expect(actions.every((item) => item.startsWith("individual: borra; ")), `${table}: an individual version goes whole`).toBe(true);
      if (entry.rule === "keep") expect(actions, table).toContain("conserva");
    }
  });
  it("redacts in immutable rows only the fields erasure mode lets through", () => {
    for (const [table, allowed] of Object.entries(REDACTABLE)) {
      for (const row of byTable.get(table)?.rows ?? []) {
        const redacts = /redacta$/.test(row.action);
        expect(redacts, `${table}.${row.fields.join(",")}`).toBe(row.fields.some((field) => allowed.includes(field)));
      }
    }
  });
});

describe("privacy inventory: providers", () => {
  const body = sliceBetween(doc, "\n## Proveedores");

  it("lists each provider with what it receives and what for", () => {
    expect([...body.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual(PROVIDERS);
    for (const chunk of body.split(/\n### /).slice(1)) {
      const name = chunk.split("\n")[0];
      expect(chunk, `${name}: Recibe`).toMatch(/^Recibe: .{20,}/m);
      expect(chunk, `${name}: Para qué`).toMatch(/^Para qué: .{20,}/m);
    }
  });
});
