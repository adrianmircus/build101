// Reconcilia las cuentas de estudiantes: retoma los aprovisionamientos que empezaron y no terminaron, y recrea con el mismo id
// las cuentas activas que alguien borró de Auth. Nunca recrea la cuenta de un estudiante suprimido.
//   npm run admin:reconcile [-- --limit 100]
// Corre con tsx y la condición react-server para que "server-only" cargue fuera de Next.js. Lee .env y .env.local. Hasta la fase 3
// se corre a mano. Es seguro repetirlo: dos corridas a la vez convergen en la misma cuenta.
import { parseArgs } from "node:util";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { reconcile } from "../../lib/server/services/admin/provisioning";

const USAGE = "Uso: npm run admin:reconcile [-- --limit 100]";
const DEFAULT_LIMIT = 100;
const Limit = z.coerce.number().int().min(1).max(200);

function readLimit(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { limit: { type: "string" } }, strict: true });
  const parsed = Limit.safeParse(values.limit ?? DEFAULT_LIMIT);
  if (!parsed.success) throw new Error(`El límite tiene que ser un número entero de 1 a 200.\n${USAGE}`);
  return parsed.data;
}

async function main(): Promise<void> {
  const limit = readLimit(process.argv.slice(2));
  const { done, failed } = await reconcile(limit);
  console.log(`Cuentas reconciliadas: ${done}. Sin terminar: ${failed}.`);
  if (failed > 0) console.log("Las que quedaron sin terminar se retoman en la próxima corrida (hasta 5 intentos cada una).");
}

main().catch((error: unknown) => {
  // Mensajes ya en español: los de AppError y los de este script. Nada de volcar el error entero (puede llevar datos).
  console.error(error instanceof AppError || error instanceof Error ? error.message : "Falló el comando.");
  process.exitCode = 1;
});
