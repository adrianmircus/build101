import type { FieldProblem } from "@/components/auth/staff/ErrorSummary";
import type { UsernameDraft } from "@/lib/domain/accounts/entities";

// The «revisar» step of creating accounts: every username that will exist, editable, with the repeated ones marked.
// The suggestion comes from previewUsernames (it knows the taken ones); the admin may change it. The server decides
// in the end (create_student gives username_taken if somebody took it meanwhile). Pure.

export type DraftRow = { key: string; displayName: string; username: string; suggested: string };

/** Why a row cannot be created yet. `taken` and `failed` come back from the server after trying. */
export type RowProblem = "empty" | "invalid" | "repeated" | "taken" | "failed";

/** The same shape the server accepts (Username in lib/domain/students). */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,39}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function draftRows(drafts: UsernameDraft[]): DraftRow[] {
  return drafts.map((draft, index) => ({
    key: `fila-${index}`,
    displayName: draft.displayName,
    username: draft.username,
    suggested: draft.username,
  }));
}

export type Flags = Record<string, "taken" | "failed">;

/** The problem of each row that has one, by key. Both rows of a repeated pair are marked, so neither is missed. */
export function rowProblems(rows: DraftRow[], flags: Flags = {}): Record<string, RowProblem> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = normalizeUsername(row.username);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const problems: Record<string, RowProblem> = {};
  for (const row of rows) {
    const name = normalizeUsername(row.username);
    const flag = flags[row.key];
    if (name === "") problems[row.key] = "empty";
    else if (!USERNAME_PATTERN.test(name)) problems[row.key] = "invalid";
    else if ((counts.get(name) ?? 0) > 1) problems[row.key] = "repeated";
    else if (flag) problems[row.key] = flag;
  }
  return problems;
}

export function problemText(problem: RowProblem): string {
  switch (problem) {
    case "empty":
      return "Falta el usuario.";
    case "invalid":
      return "Usá solo letras, números, punto, guion o guion bajo, sin espacios ni tildes (de 2 a 40 caracteres).";
    case "repeated":
      return "Está repetido en esta lista: cada estudiante necesita un usuario distinto.";
    case "taken":
      return "Justo alguien tomó este usuario. Elegí otro.";
    case "failed":
      return "No pudimos crear esta cuenta. Probá de nuevo.";
  }
}

/** A short explanation of why the suggestion looks the way it does, or of the change the admin made. */
export function noteFor(row: DraftRow): string | null {
  if (normalizeUsername(row.username) !== row.suggested) return "Lo cambiaste vos.";
  if (/^[a-z]+[2-9][0-9]*$/.test(row.suggested)) return "Ya había alguien con ese usuario, por eso lleva un número.";
  return null;
}

export function createLabel(count: number): string {
  return count === 1 ? "Crear 1 cuenta" : `Crear ${count} cuentas`;
}

export function problemsTitle(count: number): string {
  return count === 1 ? "Hay 1 usuario para corregir" : `Hay ${count} usuarios para corregir`;
}

// The line of the summary on top: short, because the full message is next to the field.
const SHORT: Record<RowProblem, string> = {
  empty: "falta el usuario",
  invalid: "el usuario tiene caracteres que no se pueden usar",
  repeated: "el usuario está repetido",
  taken: "otra persona ya tomó ese usuario",
  failed: "no se pudo crear",
};

/** What stops the confirm, row by row. A row that failed for a reason of ours («failed») can be tried again as it is. */
export function blockingProblems(rows: DraftRow[], flags: Flags = {}): FieldProblem[] {
  const problems = rowProblems(rows, flags);
  return rows.flatMap((row) => {
    const problem = problems[row.key];
    if (!problem || problem === "failed") return [];
    return [{ field: `usr-${row.key}`, message: problemText(problem), summary: `${row.displayName}: ${SHORT[problem]}` }];
  });
}
