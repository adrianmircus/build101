import { ESLint } from "eslint";
import { resolve } from "node:path";
import { beforeAll } from "vitest";

const root = resolve(__dirname, "..");
const eslint = new ESLint({ cwd: root });

/** Lints a snippet as if it lived at `filePath` and returns the ids of the rules that fired. */
export async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  return (result?.messages ?? []).flatMap((m) => (m.ruleId === null ? [] : [m.ruleId]));
}

// The first lint loads the whole config (Next plugins included) and takes seconds.
beforeAll(async () => {
  await ruleIdsFor("export const warm = 1;", "lib/domain/warm.ts");
}, 60_000);
