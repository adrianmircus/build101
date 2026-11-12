import "server-only";
import { AppError } from "@/lib/errors";

/** Body of every service of phase 2 until its ticket writes it. It takes the arguments so the signatures stay honest. */
export function unavailable(...used: readonly unknown[]): never {
  throw new AppError("UNAVAILABLE", "Todavía no está disponible.", { cause: used.length });
}
