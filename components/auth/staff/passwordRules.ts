import type { FieldProblem } from "./ErrorSummary";

// The rule of the contract for staff passwords: 10 characters at least (minimum_password_length), 72 at most (bcrypt).
// The server checks again; this is only so the person finds out before sending.

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 72;
export const PASSWORD_HINT = "Al menos 10 caracteres. Una frase corta que te acuerdes sirve.";

export function passwordMessage(password: string): string | null {
  if (password === "") return "Escribí la contraseña que querés usar.";
  if (password.length < MIN_PASSWORD) return `Le faltan ${MIN_PASSWORD - password.length} caracteres: tiene que tener al menos ${MIN_PASSWORD}.`;
  if (password.length > MAX_PASSWORD) return `Es muy larga: tiene que tener ${MAX_PASSWORD} caracteres como máximo.`;
  return null;
}

export function newPasswordProblems(password: string, confirm: string, ids: { password: string; confirm: string }): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const message = passwordMessage(password);
  if (message) problems.push({ field: ids.password, message });
  if (message === null && confirm !== password) {
    problems.push({ field: ids.confirm, message: confirm === "" ? "Repetí la contraseña para confirmarla." : "Las dos contraseñas no son iguales." });
  }
  return problems;
}

export function summaryTitle(count: number): string {
  return count === 1 ? "Hay un dato para revisar" : `Hay ${count} datos para revisar`;
}
