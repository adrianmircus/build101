import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERASURE_RULES, STUDENT_DATA_TABLES } from "./erasure";
import { parseInventoryTables, parseSchemaColumns, parseSqlTableList, sliceBetween } from "./inventory";
import { APP_TABLES } from "./tables";

// docs/PRIVACIDAD-DATOS.md (T1.9) against the schema, erasure.ts and the database test's literal list.

const root = join(__dirname, "..", "..", "..");
const doc = readFileSync(join(root, "docs", "PRIVACIDAD-DATOS.md"), "utf8");
const sqlTest = readFileSync(join(root, "supabase", "tests", "006_inventory.test.sql"), "utf8");
const migrationsDir = join(root, "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"));

const sections = parseInventoryTables(doc);
const byTable = new Map(sections.map((item) => [item.table, item]));
const studentTables = new Set<string>(STUDENT_DATA_TABLES);
const NOT_IN_ERASURE: string[] = ["sin datos de estudiantes", "fuera de erasure.ts"];
// Tables that hold data about students and have no rule in erasure.ts. The doc says so. Closing a
// gap means changing erasure.ts (T9.5) and then this list.
const KNOWN_GAPS = ["app_users", "assessments", "memberships", "presets"];
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
const REDACTABLE: Record<string, string> = {
  version_events: "data",
  generation_outputs: "output",
  answer_key_revisions: "content",
  publications: "content",
  generations: "inputs",
};

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

  it("marks every other table as without student data or as a known gap", () => {
    const others = sections.filter((item) => !studentTables.has(item.table));
    for (const item of others) expect(NOT_IN_ERASURE, item.table).toContain(item.rule);
    const gaps = others.filter((item) => item.rule === "fuera de erasure.ts").map((item) => item.table);
    expect(sorted(gaps)).toEqual(KNOWN_GAPS);
  });
});

describe("privacy inventory: fields", () => {
  const columns = parseSchemaColumns(migrations);

  it("covers every column of every table, once", () => {
    for (const table of APP_TABLES) {
      const real = columns.get(table);
      expect(real, `${table} is not in the migrations`).toBeDefined();
      const documented = (byTable.get(table)?.rows ?? []).flatMap((row) => row.fields);
      expect(new Set(documented).size, `${table}: a field appears twice`).toBe(documented.length);
      expect(sorted(documented), table).toEqual(sorted(real ?? []));
    }
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

  it("matches each rule with what its fields do", () => {
    for (const [table, entry] of Object.entries(ERASURE_RULES)) {
      const actions = (byTable.get(table)?.rows ?? []).map((row) => row.action);
      if (entry.rule === "delete") expect(actions.every((item) => item === "borra"), `${table} deletes every field`).toBe(true);
      if (entry.rule === "by_version") expect(actions.every((item) => item.startsWith("individual: borra; ")), `${table}: an individual version goes whole`).toBe(true);
      if (entry.rule === "redact") expect(actions, table).toContain("redacta");
      if (entry.rule === "unlink") expect(actions, table).toContain("desvincula");
      if (entry.rule === "keep") expect(actions, table).toContain("conserva");
    }
  });

  it("redacts in immutable rows only the field erasure mode lets through", () => {
    for (const [table, field] of Object.entries(REDACTABLE)) {
      const rows = byTable.get(table)?.rows ?? [];
      expect(rows.find((row) => row.fields.includes(field))?.action, `${table}.${field}`).toMatch(/compartida: redacta$/);
      for (const row of rows.filter((item) => !item.fields.includes(field))) expect(row.action, `${table}.${row.fields.join(",")}`).not.toMatch(/redacta/);
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
