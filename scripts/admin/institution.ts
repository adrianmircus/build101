// Da de alta una institución con su primer admin y muestra el enlace de la invitación SOLO en esta terminal.
//   npm run admin:institution -- --name "Colegio X" --code colegio-x --admin admin@colegio.uy [--send]
// Corre con tsx y la condición react-server para que "server-only" cargue fuera de Next.js. Lee .env y .env.local.
// Si la base no es local, pide escribir el código de la institución antes de tocar nada.
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { getMailSender, invitationMail } from "../../lib/server/mail";
import { createInstitutionWithAdmin, NewInstitutionInput } from "../../lib/server/services/admin/institution";

const USAGE = 'Uso: npm run admin:institution -- --name "Colegio X" --code colegio-x --admin admin@colegio.uy [--send]';
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const Args = NewInstitutionInput.extend({ send: z.boolean() });

function readArgs(argv: string[]): z.infer<typeof Args> {
  const { values } = parseArgs({
    args: argv,
    options: { name: { type: "string" }, code: { type: "string" }, admin: { type: "string" }, send: { type: "boolean", default: false } },
    strict: true,
  });
  const parsed = Args.safeParse({ name: values.name, code: values.code, adminEmail: values.admin, send: values.send });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] === "adminEmail" ? "admin" : issue.path[0])))];
    throw new Error(`Argumentos inválidos o faltantes: ${fields.join(", ")}. El código lleva de 3 a 32 letras minúsculas, números o guiones.\n${USAGE}`);
  }
  return parsed.data;
}

function isLocal(rawUrl: string | undefined): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(rawUrl ?? "").hostname);
  } catch {
    return false;
  }
}

/** Fuera de la base local hay que escribir el código de la institución: sin terminal o con otro texto, no sigue. */
async function confirmRemote(code: string): Promise<void> {
  const target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  console.log(`ATENCIÓN: esta base no es local (${target}). Se va a crear la institución "${code}" de verdad.`);
  if (!process.stdin.isTTY) throw new Error("No hay una terminal para confirmar. Corré el comando desde una terminal.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Para seguir, escribí el código (${code}): `)).trim();
    if (answer !== code) throw new Error("El código no coincide. No se hizo nada.");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const code = args.code.trim().toLowerCase();
  if (!isLocal(process.env.NEXT_PUBLIC_SUPABASE_URL)) await confirmRemote(code);

  const result = await createInstitutionWithAdmin(args);
  console.log(`Institución "${code}": ${result.institutionId}`);
  if (result.outcome === "already_admin") {
    console.log("Ese correo ya es admin de la institución. No se hizo nada más.");
    return;
  }
  if (result.outcome === "already_pending" || result.invitationLink === null) {
    console.log("Ese correo ya tiene una invitación pendiente. El enlace no se puede volver a ver: vence a los 7 días y entonces se corre el comando de nuevo.");
    return;
  }
  console.log("Invitación del primer admin creada. El enlace se muestra una sola vez; no queda guardado ni en los logs:");
  console.log(result.invitationLink);
  if (!args.send) return;
  await getMailSender().send(invitationMail({ to: args.adminEmail.trim().toLowerCase(), institutionName: args.name.trim(), inviterName: null, role: "admin", link: result.invitationLink, expiresAt: result.expiresAt ?? "" }));
  console.log("Correo enviado.");
}

main().catch((error: unknown) => {
  // Mensajes ya en español: los de AppError y los de este script. Nada de volcar el error entero (puede llevar datos).
  console.error(error instanceof AppError || error instanceof Error ? error.message : "Falló el comando.");
  process.exitCode = 1;
});
