// Readers for docs/PRIVACIDAD-DATOS.md, the migrations and supabase/tests/006_inventory.test.sql.
// Pure functions over text: the test reads the files and passes them in. Nothing here runs in the app.

export type InventoryRow = { fields: string[]; action: string; after: string; why: string };
export type InventorySection = { table: string; rule: string; rows: InventoryRow[] };

/** The text from `from` up to `to` (or the end); throws if `from` is missing. */
export function sliceBetween(text: string, from: string, to?: string): string {
  const start = text.indexOf(from);
  if (start < 0) throw new Error(`Falta "${from}"`);
  const end = to === undefined ? -1 : text.indexOf(to, start);
  return text.slice(start, end < 0 ? text.length : end);
}

function parseRow(line: string): InventoryRow {
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  return {
    fields: [...(cells[0] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""),
    action: cells[1] ?? "",
    after: cells[2] ?? "",
    why: cells[3] ?? "",
  };
}

/** The per-table sections of the doc: its rule and one row per group of fields. */
export function parseInventoryTables(doc: string): InventorySection[] {
  const body = sliceBetween(doc, "\n## Tablas", "\n## Lo que erasure.ts no cubre");
  return body
    .split(/\n### /)
    .slice(1)
    .map((chunk) => ({
      table: /^`([a-z_]+)`/.exec(chunk)?.[1] ?? "",
      rule: /^Regla: `([^`]+)`\./m.exec(chunk)?.[1] ?? "",
      rows: chunk
        .split("\n")
        .filter((line) => line.startsWith("| `"))
        .map(parseRow),
    }));
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let level = 0;
  let current = "";
  for (const char of text) {
    level += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (char === "," && level === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  return [...parts, current];
}

function tableBody(sql: string, from: number): string {
  let depth = 1;
  let index = from;
  while (depth > 0 && index < sql.length) {
    const char = sql[index++];
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
  }
  return sql.slice(from, index - 1);
}

/** Column names of each `create table app.<name> (...)`. Migrations do not alter tables later. */
export function parseSchemaColumns(migrations: string[]): Map<string, string[]> {
  const columns = new Map<string, string[]>();
  for (const raw of migrations) {
    const sql = raw.replace(/--[^\n]*/g, "");
    for (const match of sql.matchAll(/create table app\.([a-z_]+)\s*\(/g)) {
      const names = splitTopLevel(tableBody(sql, (match.index ?? 0) + match[0].length))
        .map((part) => part.trim())
        .filter((part) => part !== "" && !/^(unique|foreign|check|primary|constraint|exclude)\b/i.test(part))
        .map((part) => /^"?([a-z_][a-z0-9_]*)"?/.exec(part)?.[1] ?? "");
      columns.set(match[1] ?? "", names);
    }
  }
  return columns;
}

/** The literal table list of 006_inventory between its markers. */
export function parseSqlTableList(sql: string): string[] {
  const list = sliceBetween(sql, "-- inventory:begin", "-- inventory:end");
  return [...list.matchAll(/\(\s*'([a-z_]+)'\s*\)/g)].map((match) => match[1] ?? "");
}
