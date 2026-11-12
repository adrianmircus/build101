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
  const body = sliceBetween(doc, "\n## Tablas", "\n## Orden de la supresión");
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

/** The literal table list of 006_inventory between its markers. */
export function parseSqlTableList(sql: string): string[] {
  const list = sliceBetween(sql, "-- inventory:begin", "-- inventory:end");
  return [...list.matchAll(/\(\s*'([a-z_]+)'\s*\)/g)].map((match) => match[1] ?? "");
}

/** The literal `table.column` list of 006_inventory between its markers. */
export function parseSqlColumnList(sql: string): string[] {
  const list = sliceBetween(sql, "-- columns:begin", "-- columns:end");
  return [...list.matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*\)/g)].map((match) => match[1] ?? "");
}

/** Every `table.column` the doc lists. */
export function documentedColumns(sections: InventorySection[]): string[] {
  return sections.flatMap((item) => item.rows.flatMap((row) => row.fields.map((field) => `${item.table}.${field}`)));
}

/**
 * The fields the doc says are unlinked or redacted, as `table.field` to action. For tables that
 * follow a version, the action is the one for a shared version (an individual one goes whole).
 */
export function changedFields(sections: InventorySection[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of sections) {
    for (const row of item.rows) {
      const action = row.action.replace(/^individual: [a-z]+; compartida: /, "");
      if (action !== "desvincula" && action !== "redacta") continue;
      for (const field of row.fields) result[`${item.table}.${field}`] = action;
    }
  }
  return result;
}