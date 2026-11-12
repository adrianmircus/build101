import { DisplayName } from "@/lib/domain/common";

// The names pasted to create accounts: one per line, as they come from a spreadsheet. Pure.

/** What createStudentAccounts accepts in one request. */
export const MAX_NAMES = 60;

export type NamesProblem = "empty" | "too_many" | "too_long";

/** Each non-empty line, with the spaces and tabs between words collapsed to a single space. */
export function parseNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

export function namesProblem(names: string[]): NamesProblem | null {
  if (names.length === 0) return "empty";
  if (names.length > MAX_NAMES) return "too_many";
  if (names.some((name) => !DisplayName.safeParse(name).success)) return "too_long";
  return null;
}

export function namesProblemText(problem: NamesProblem): string {
  if (problem === "empty") return "Pegá al menos un nombre.";
  if (problem === "too_many") return `Son más de ${MAX_NAMES} nombres. Creá las cuentas de a ${MAX_NAMES} por vez.`;
  return "Hay un nombre demasiado largo. Revisá que cada línea tenga un solo nombre.";
}
