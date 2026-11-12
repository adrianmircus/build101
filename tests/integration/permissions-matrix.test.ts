import { beforeAll, describe, expect, it } from "vitest";
import { operationsFor } from "@/lib/domain/permissions/matrix";
import { APP_TABLES } from "@/lib/domain/permissions/tables";
import { buildWorld, type World } from "./matrix/fixtures";
import { probeTable, visitorsOf } from "./matrix/rest";
import { cellsOf, checkOperation } from "./matrix/run";

// T1.8: the permissions matrix (lib/domain/permissions/matrix.ts) against the real RPCs. A scene per
// kind of institution, one logged-in user per role, and every row of the matrix as every role.

const OPERATIONS = operationsFor(1);

describe("permissions matrix: every operation as every role", () => {
  let world: World;
  beforeAll(async () => {
    world = await buildWorld();
  }, 120_000);

  it("has a row for each operation of phase 1", () => {
    expect(OPERATIONS.length).toBeGreaterThan(0);
    expect(OPERATIONS.reduce((total, op) => total + cellsOf(op).length, 0)).toBeGreaterThan(0);
  });

  it.concurrent.each(OPERATIONS.map((op) => [op.rpc, op] as const))("%s", async (_name, op) => {
    expect(await checkOperation(world, op)).toEqual([]);
  }, 180_000);
});

describe("permissions matrix: no table of the contract is reachable through REST", () => {
  let world: World;
  beforeAll(async () => {
    world = await buildWorld();
  }, 120_000);

  it.concurrent.each(APP_TABLES.map((table) => [table] as const))("%s does not exist for any role", async (table) => {
    const found: string[] = [];
    for (const visitor of await visitorsOf(world)) {
      const own = await probeTable(table, visitor, null);
      if (own.status !== 404) found.push(`${visitor.name}: ${table} en api dio ${own.status} ${own.code ?? ""}`);
      for (const profile of ["app", "public"]) {
        const asked = await probeTable(table, visitor, profile);
        if (asked.code !== "PGRST106") found.push(`${visitor.name}: ${table} con Accept-Profile ${profile} dio ${asked.status} ${asked.code ?? ""}`);
      }
    }
    expect(found).toEqual([]);
  }, 60_000);
});
