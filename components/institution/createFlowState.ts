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
  /** The attempt of the accounts request: kept after an error or a lost answer, renewed only when the content changes. */
  attempt: Attempt | null;
  /** The same for createGroup: saved BEFORE the request goes out, so a lost answer is retried with the same opKey. */
  groupAttempt: Attempt | null;
};

export type CreateAction =
  | { type: "field"; name: keyof Fields; value: string }
  | { type: "reviewing"; rows: DraftRow[] }
  | { type: "edit"; key: string; value: string }
  | { type: "back" }
  | { type: "groupReady"; groupId: string }
  | { type: "groupAttempt"; attempt: Attempt }
  | { type: "started"; groupId: string; attempt: Attempt }
  | { type: "results"; results: CreatedAccountRow[] };

export function initialCreate(fields: Fields): CreateState {
  return { step: "paste", fields, rows: [], flags: {}, groupId: null, createdIds: [], attempt: null, groupAttempt: null };
}

export function createReducer(state: CreateState, action: CreateAction): CreateState {
  switch (action.type) {
    case "field":
      // Another group or another name is another request: the group made for the old one is not reused.
      return { ...state, fields: { ...state.fields, [action.name]: action.value }, groupId: action.name === "names" ? state.groupId : null };
    case "reviewing":
      return { ...state, step: "review", rows: action.rows, flags: {}, createdIds: [], attempt: null };
    case "edit": {
      const flags = { ...state.flags };
      delete flags[action.key];
      return { ...state, rows: state.rows.map((row) => (row.key === action.key ? { ...row, username: action.value } : row)), flags, attempt: null };
    }
    case "back":
      return { ...state, step: "paste", rows: [], flags: {}, attempt: null };
    case "groupReady":
      return { ...state, groupId: action.groupId };
    case "groupAttempt":
      return { ...state, groupAttempt: action.attempt };
    case "started":
      // The group exists now: its attempt is spent, so a later group with the same data is a new one.
      return { ...state, groupId: action.groupId, attempt: action.attempt, groupAttempt: null };
    case "results":
      return applyResults(state, action.results);
  }
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
    flags[row.key] = result?.outcome === "username_taken" ? "taken" : "failed";
  });
  return { ...state, step: rows.length === 0 ? "done" : "review", rows, flags, createdIds, attempt: null };
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

/** What identifies a request: the same signature means the same accounts for the same group. */
export function requestSignature(state: CreateState): string {
  return JSON.stringify([state.groupId, state.rows.map((row) => [row.displayName, normalizeUsername(row.username)])]);
}
