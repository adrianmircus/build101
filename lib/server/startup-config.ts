import "server-only";
import { mailProblems } from "./mail/config";

// What a production server needs to be able to start (F2-10). Without it the app would run thinking it sends mail or counts
// login attempts, and the failure would show up later, far from its cause (an invitation that "fails to send", a login that
// is refused). So the server does not start. The messages name the variables, never their values, and are in Spanish for
// whoever reads the deploy log. instrumentation.ts loads it before anything else.

export type StartupEnv = Readonly<Record<string, string | undefined>>;

const filled = (value: string | undefined): boolean => (value ?? "").trim() !== "";

function siteUrlProblem(value: string | undefined): string | null {
  if (!filled(value)) return "NEXT_PUBLIC_SITE_URL (la dirección pública del sitio)";
  try {
    const url = new URL((value ?? "").trim());
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return null;
  } catch {
    // Not an address: the same problem as a missing one.
  }
  return "NEXT_PUBLIC_SITE_URL (tiene que ser una dirección https, o http solo en localhost)";
}

/** The problems of a production configuration, one line per variable. Empty when it is complete. Names only, never values. */
export function configProblems(env: StartupEnv): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  // The same rule that chooses the sender (lib/server/mail/config.ts): what starts can send.
  problems.push(...mailProblems(env));
  if ((env.RATE_LIMIT_SECRET ?? "").length < 32) problems.push("RATE_LIMIT_SECRET (32 caracteres como mínimo)");
  const site = siteUrlProblem(env.NEXT_PUBLIC_SITE_URL);
  if (site !== null) problems.push(site);
  return problems;
}

/** Throws one clear error, in Spanish, listing every variable that is missing; does nothing outside production. */
export function assertStartupConfig(env: StartupEnv = process.env): void {
  const problems = configProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Falta configuración para arrancar en producción. Definí estas variables de entorno y volvé a desplegar (mirá .env.example):\n${problems.map((line) => `- ${line}`).join("\n")}`,
  );
}
