import type { Failure } from "@/lib/errors";

// What a failed action says to a teacher. The services answer UNAVAILABLE until phase 2 closes: that is a decent
// message too, never the raw «Todavía no está disponible» of a stub. Nothing here echoes what the person typed.

export type FailureKind = "blocked" | "stale" | "invalid" | "unavailable";

export function failureKind(failure: Failure): FailureKind {
  if (failure.code === "RATE_LIMITED") return "blocked";
  if (failure.code === "STALE_CLIENT") return "stale";
  if (failure.code === "INVALID") return "invalid";
  return "unavailable";
}

const TEXT: Record<FailureKind, string> = {
  blocked: "Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.",
  stale: "Se actualizó Tiza. Recargá la página para seguir; lo que escribiste no se pierde si la recargás ahora.",
  invalid: "Revisá los datos y probá de nuevo.",
  unavailable: "No pudimos completar esto ahora. No es por vos: probá de nuevo en un rato.",
};

export function failureText(failure: Failure): string {
  return TEXT[failureKind(failure)];
}

/** The message of a field the server rejected, when it sent one for that name. */
export function fieldMessage(failure: Failure, name: string): string | undefined {
  return failure.fields?.[name];
}
