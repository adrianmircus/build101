import { z } from "zod";

// The school that the global setup makes for the run. It travels in one environment variable so the workers read it without a file.

const KEY = "E2E_WORLD";

const World = z.object({
  institution: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  admin: z.object({ email: z.string(), password: z.string() }),
  teacher: z.object({ email: z.string(), password: z.string() }),
  group: z.object({ id: z.string(), name: z.string() }),
  run: z.string(),
});
export type World = z.infer<typeof World>;

export function setWorld(world: World): void {
  process.env[KEY] = JSON.stringify(world);
}

export function clearWorld(): void {
  Reflect.deleteProperty(process.env, KEY);
}

/** The school of this run. Throws when the global setup did not run (a spec started on its own). */
export function world(): World {
  const raw = process.env[KEY];
  if (raw === undefined) throw new Error("Falta el colegio de la corrida: corré las pruebas con `npm run test:e2e`.");
  return World.parse(JSON.parse(raw));
}
