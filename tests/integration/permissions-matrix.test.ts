import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operationsFor } from "@/lib/domain/permissions/matrix";
import { APP_TABLES } from "@/lib/domain/permissions/tables";
import { buildWorld, type World } from "./matrix/fixtures";
import { probeTable, visitorsOf } from "./matrix/rest";
import { purgeScenesWithInvitations } from "./matrix/calls-accounts";
import { cellsOf, checkOperation } from "./matrix/run";

// T1.8: the permissions matrix (lib/domain/permissions/matrix.ts) against the real RPCs. A scene per
// kind of institution, one logged-in user per role, and every row of the matrix as every role.

// The rows of phase 1 and, as each ticket of phase 2 implements its RPCs, the ones of that ticket (T2.3: invitations and the panel;
// T2.5a: the accounts of the students).
const IMPLEMENTED_IN_PHASE_2 = ["T2.3", "T2.5a"];
const OPERATIONS = [
  ...operationsFor(1),
  ...operationsFor(2).filter((operation) => operation.since === 2 && IMPLEMENTED_IN_PHASE_2.includes(operation.ticket)),
];

describe("permissions matrix: every operation as every role", () => {
  let world: World;
  // The invitations the calls made go with their institutions: a revoked one is final and the pgTAP files update the whole table.
  afterAll(purgeScenesWithInvitations, 60_000);
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
