import type { FieldProblem } from "@/components/auth/staff/ErrorSummary";
import type { CreatedAccountRow } from "@/lib/domain/accounts/results";
import { MAX_NAMES, namesProblem, namesProblemText, parseNames } from "./nameList";
import type { Attempt } from "./opKey";
import { normalizeUsername, type DraftRow, type Flags } from "./usernameReview";

// State of «Crear cuentas de estudiantes»: paste, review, done. A reducer so that every state is tested without a browser.

export const NEW_GROUP = "nuevo";
export const MAX_ROWS = MAX_NAMES;

export type Fields = { groupChoice: string; groupName: string; subjectId: string; schoolYear: string; names: string };

export type CreateState = {
  step: "paste" | "review" | "done";
  fields: Fields;
  rows: DraftRow[];
  flags: Flags;
  /** Set once the group exists (chosen, or created on the first confirm), so a retry never makes a second one. */
  groupId: string | null;
  createdIds: string[];
  /** The next free identity for a row. Never goes back: a row that was created keeps its slot forever, so no other row can take it. */
  nextSlot: number;
  /** The attempt of the accounts request: kept after an error, a lost answer or a partial result, renewed only when the group changes. */
  attempt: Attempt | null;
  /** The same for createGroup: saved BEFORE the request goes out, so a lost answer is retried with the same opKey. */
  groupAttempt: Attempt | null;
  /** The flags the rows had when the confirm began, to give them back if the group could not be made (nothing of the rows went out). */
  beforeConfirm: Flags | null;
};

export type CreateAction =
  | { type: "field"; name: keyof Fields; value: string }
  | { type: "reviewing"; rows: DraftRow[] }
  | { type: "edit"; key: string; value: string }
  | { type: "back" }
  | { type: "groupReady"; groupId: string }
  | { type: "groupAttempt"; attempt: Attempt }
  | { type: "confirm"; begin: boolean }
  | { type: "started"; groupId: string; attempt: Attempt }
  | { type: "lost" }
  | { type: "results"; results: CreatedAccountRow[] };

export function initialCreate(fields: Fields): CreateState {
  return { step: "paste", fields, rows: [], flags: {}, groupId: null, createdIds: [], nextSlot: 0, attempt: null, groupAttempt: null, beforeConfirm: null };
}

function editRow(state: CreateState, key: string, value: string): CreateState {
  // An uncertain row may already exist on the server, and a row being sent may be created any moment: its identity (username and slot) does not change until it is sure.
  if (state.flags[key] === "uncertain" || state.flags[key] === "sending") return state;
  const flags = { ...state.flags };
  delete flags[key];
  // Another username is another student for the server: the row takes a new slot (a new op_key). The rest keep theirs.
  let nextSlot = state.nextSlot;
  const rows = state.rows.map((row) => {
    if (row.key !== key) return row;
    if (normalizeUsername(row.username) === normalizeUsername(value)) return { ...row, username: value };
    return { ...row, username: value, slot: nextSlot++ };
  });
  return { ...state, rows, flags, nextSlot };
}

/** Going back would drop the attempt and suggest other usernames: with a row that may already exist, the same person could be created twice. */
function goBack(state: CreateState): CreateState {
  return hasUnsettled(state.flags) ? state : { ...state, step: "paste", rows: [], flags: {}, attempt: null };
}

// Another group or another name is another request: the group made for the old one is not reused.
function setField(state: CreateState, name: keyof Fields, value: string): CreateState {
  return { ...state, fields: { ...state.fields, [name]: value }, groupId: name === "names" ? state.groupId : null };
}

export function createReducer(state: CreateState, action: CreateAction): CreateState {
  switch (action.type) {
    case "field":
      return setField(state, action.name, action.value);
    case "reviewing":
      return { ...state, step: "review", rows: action.rows, flags: {}, createdIds: [], nextSlot: Math.max(0, ...action.rows.map((row) => row.slot + 1)), attempt: null };
    case "edit":
      return editRow(state, action.key, action.value);
    case "back":
      return goBack(state);
    case "groupReady":
      return { ...state, groupId: action.groupId };
    case "groupAttempt":
      return { ...state, groupAttempt: action.attempt };
    default:
      return requestReducer(state, action);
  }
}

/** The actions of the request itself (from the confirm to the answer), apart so each reducer stays small. */
function requestReducer(state: CreateState, action: Extract<CreateAction, { type: "confirm" | "started" | "lost" | "results" }>): CreateState {
  switch (action.type) {
    case "confirm":
      return action.begin ? confirming(state) : released(state);
    case "started":
      return started(state, action.groupId, action.attempt);
    case "lost":
      return lost(state);
    case "results":
      return applyResults(state, action.results);
  }
}

/** Is there a row that may or may not exist on the server? While there is, the only way forward is to create again, with the same identity. */
export function hasUncertain(flags: Flags): boolean {
  return Object.values(flags).includes("uncertain");
}

/**
 * The confirm begins: from this very moment, before waiting for the group, the rows are «sending». Nobody edits them (their identity, username and slot,
 * is the one the request will carry) or goes back to the names. A row that was already uncertain stays uncertain.
 */
function confirming(state: CreateState): CreateState {
  if (state.beforeConfirm) return state;
  const flags: Flags = {};
  for (const row of state.rows) flags[row.key] = state.flags[row.key] === "uncertain" ? "uncertain" : "sending";
  return { ...state, flags, beforeConfirm: state.flags };
}

/** The group could not be made: no row went out, so editing and going back are possible again. The group is retried with its own key, already saved. */
function released(state: CreateState): CreateState {
  if (!state.beforeConfirm) return state;
  return { ...state, flags: state.beforeConfirm, beforeConfirm: null };
}

/**
 * The group exists now: its attempt is spent, so a later group with the same data is a new one. And the rows go out: from here until the
 * answer they are «sending», and nobody edits them or goes back.
 */
function started(state: CreateState, groupId: string, attempt: Attempt): CreateState {
  const flags: Flags = {};
  for (const row of state.rows) flags[row.key] = "sending";
  return { ...state, groupId, attempt, groupAttempt: null, flags, beforeConfirm: null };
}

/** The whole request failed or its answer never came: any of the rows may exist. They keep their identity and only «Volver a crear» is left. */
function lost(state: CreateState): CreateState {
  const flags: Flags = {};
  for (const [key, flag] of Object.entries(state.flags)) flags[key] = flag === "sending" ? "uncertain" : flag;
  return { ...state, flags };
}

/** Is there a row in a request that has not answered? Same rule as an uncertain one, until the answer comes. */
export function isSending(flags: Flags): boolean {
  return Object.values(flags).includes("sending");
}

/** A row that may or may not exist (uncertain), or is being sent: nothing about the list changes and there is no going back. */
export function hasUnsettled(flags: Flags): boolean {
  return hasUncertain(flags) || isSending(flags);
}

/** The rows created leave the list (and are counted); the others stay with what went wrong, to fix and try again. */
function applyResults(state: CreateState, results: CreatedAccountRow[]): CreateState {
  const byIndex = new Map(results.map((result) => [result.index, result]));
  const createdIds = [...state.createdIds];
  const flags: Flags = {};
  const rows: DraftRow[] = [];
  state.rows.forEach((row, index) => {
    const result = byIndex.get(index);
    if (result?.outcome === "created" && result.studentId) return void createdIds.push(result.studentId);
    rows.push(row);
    flags[row.key] = result?.outcome === "username_taken" ? "taken" : result?.outcome === "uncertain" ? "uncertain" : "failed";
  });
  // The attempt stays: the rows that are left keep their slot, so a retry sends the same opKey and each row the same identity.
  return { ...state, step: rows.length === 0 ? "done" : "review", rows, flags, createdIds };
}

/** What the admin still has to fix in step one, one message per field (the field ids are the ones of the form). */
export function pasteProblems(fields: Fields, subjectIds: string[], year: { min: number; max: number }): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (fields.groupChoice === NEW_GROUP) {
    if (fields.groupName.trim() === "") problems.push({ field: "cr-grupo-nombre", message: "Escribí el nombre del grupo, por ejemplo 4.º B." });
    if (!subjectIds.includes(fields.subjectId)) problems.push({ field: "cr-grupo-materia", message: "Elegí la materia del grupo." });
    const value = Number(fields.schoolYear);
    if (!Number.isInteger(value) || value < year.min || value > year.max) {
      problems.push({ field: "cr-grupo-anio", message: "Escribí el año lectivo con cuatro cifras, por ejemplo 2026." });
    }
  }
  const problem = namesProblem(parseNames(fields.names));
  if (problem) problems.push({ field: "cr-nombres", message: namesProblemText(problem) });
  return problems;
}

/** What identifies a request: the same signature means the same group, and so the same opKey. */
export function requestSignature(state: CreateState): string {
  // The rows do not enter: each one carries its own identity (slot) and an edited one gets a new slot, so the same opKey is safe.
  return JSON.stringify([state.groupId]);
}
