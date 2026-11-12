import { createClient } from "@supabase/supabase-js";
import { isInternalRpc, type RpcName } from "@/lib/domain/rpc";
import type { MatrixRole, Operation, Outcome as Expected } from "@/lib/domain/permissions/roles";
import { readPublicDbEnv } from "@/lib/server/db/env";
import { runRpc } from "../support/db";
import { describeOutcome, type Actor, type Outcome, type RpcArgs } from "../support/session";
import { CALLS } from "./calls";
import type { Member, Scene, World } from "./fixtures";
import type { Prepared } from "./types";

// Runs one row of the matrix: every role (plus the other student of the group and a teacher of
// another institution) calls the operation on resources made for it, and the outcome is compared
// with what the matrix says.

export type Column = MatrixRole | "other_student" | "other_institution";
export type Cell = { column: Column; expected: Expected };
/** What a cell runs: the operation, the scene it runs in and the call prepared over that scene. */
type Use = { rpc: RpcName; scene: Scene; prepared: Prepared };

export function cellsOf(op: Operation): Cell[] {
  const roles = Object.entries(op.access).map(([role, expected]) => ({ column: toColumn(role), expected }));
  return [...roles, { column: "other_student", expected: "deny" }, { column: "other_institution", expected: "deny" }];
}

function toColumn(role: string): Column {
  switch (role) {
    case "admin": case "teacher_of_group": case "teacher_other_group": case "inclusion":
    case "student": case "sandbox_anonymous": case "no_session":
      return role;
    default:
      throw new Error(`Rol desconocido en la matriz: ${role}.`);
  }
}

const sceneFor = (world: World, column: Column): Scene => (column === "sandbox_anonymous" ? world.sandbox : world.school);

function memberFor(world: World, column: Column): Member | null {
  const { school } = world;
  const members: Record<Column, Member | null> = {
    admin: school.admin,
    teacher_of_group: school.owner,
    teacher_other_group: school.otherTeacher,
    inclusion: school.inclusion,
    student: school.learner,
    other_student: school.peer,
    sandbox_anonymous: world.sandbox.owner,
    other_institution: world.outsider,
    no_session: null,
  };
  return members[column];
}

/** The publishable key alone: what any visitor of the site can build. */
async function callAnonymous(name: string, args: RpcArgs): Promise<Outcome> {
  const { url, publishableKey } = readPublicDbEnv();
  const anon = createClient(url, publishableKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.rpc(name, args);
  if (error) return { ok: false, state: error.code, message: error.message, reason: error.details };
  return { ok: true, value: { data } };
}

function callAs(actor: Actor | null, name: string, args: RpcArgs): Promise<Outcome> {
  return actor === null ? callAnonymous(name, args) : runRpc(actor, name, args);
}

function protectedIds(scene: Scene, prepared: Prepared): string[] {
  return [prepared.target ?? scene.learner.studentId, scene.learner.studentId];
}

/** What is wrong with this outcome, or null when it is what the matrix says. */
export function judge(cell: Cell, outcome: Outcome, use: Use): string | null {
  const { rpc, scene, prepared } = use;
  const wantsAccess = cell.expected !== "deny" || (cell.column === "other_student" && prepared.sharedWithPeers === true);
  if (wantsAccess) return judgeAccess(outcome, prepared);
  if (outcome.ok) return judgeListing(outcome, scene, prepared);
  // The publishable key alone never reaches the RPC: the API answers permission denied (42501) before any of ours runs.
  if (cell.column === "no_session") return outcome.state === "42501" ? null : `sin sesión debía dar 42501 y dio ${describeOutcome(outcome)}`;
  const denied = isInternalRpc(rpc) ? outcome.state === "42501" : outcome.state === "P0001" && ["FORBIDDEN", "NOT_FOUND"].includes(outcome.message);
  return denied ? null : `debía negarse con FORBIDDEN o NOT_FOUND y dio ${describeOutcome(outcome)}`;
}

function judgeAccess(outcome: Outcome, prepared: Prepared): string | null {
  if (!outcome.ok) return `debía tener éxito y dio ${describeOutcome(outcome)}`;
  const mentions = prepared.target === undefined || JSON.stringify(outcome.value).includes(prepared.target);
  return mentions ? null : "tuvo éxito pero la respuesta no incluye el objetivo";
}

function judgeListing(outcome: Extract<Outcome, { ok: true }>, scene: Scene, prepared: Prepared): string | null {
  if (prepared.listing !== true) return "debía negarse y tuvo éxito";
  const text = JSON.stringify(outcome.value);
  const leaked = protectedIds(scene, prepared).filter((id) => text.includes(id));
  return leaked.length === 0 ? null : "el listado devolvió el objetivo a quien no debía verlo";
}

async function runCell(world: World, cell: Cell, use: Use): Promise<string | null> {
  const { rpc, prepared } = use;
  const who = memberFor(world, cell.column);
  const outcome = await callAs(who === null ? null : who.actor, rpc, prepared.args);
  const problem = judge(cell, outcome, use);
  return problem === null ? null : `${rpc} como ${cell.column} (se esperaba ${cell.expected}): ${problem}`;
}

/** Denials first, all over the same resources (a denial changes nothing); every success on resources of its own. */
export async function checkOperation(world: World, op: Operation): Promise<string[]> {
  const problems: string[] = [];
  const cells = cellsOf(op);
  const denied = cells.filter((cell) => cell.expected === "deny");
  const allowed = cells.filter((cell) => cell.expected !== "deny");
  for (const scene of new Set(denied.map((cell) => sceneFor(world, cell.column)))) {
    const prepared = await CALLS[op.rpc](scene);
    for (const cell of denied.filter((candidate) => sceneFor(world, candidate.column) === scene)) {
      const found = await runCell(world, cell, { rpc: op.rpc, scene, prepared });
      if (found !== null) problems.push(found);
    }
  }
  for (const cell of allowed) {
    const scene = sceneFor(world, cell.column);
    const found = await runCell(world, cell, { rpc: op.rpc, scene, prepared: await CALLS[op.rpc](scene) });
    if (found !== null) problems.push(found);
  }
  return problems;
}
