// Pure logic of scripts/check-ticket.mjs: which files changed and which gates run for them.
// Kept free of I/O so it can be unit-tested (plan.test.ts) without git or child processes.

const CODE_FILE = /\.(?:ts|tsx|mjs|js)$/;
// ESLint config and rules: no test imports them, so `vitest related` cannot find eslint/*.test.ts.
const ESLINT_SETUP = /^(?:eslint\/|eslint\.config\.mjs$)/;

/**
 * @typedef {{ id: string, label: string, command: string, args: string[] }} RunStep
 * @typedef {{ id: string, label: string, skipped: string }} SkippedStep
 * @typedef {RunStep | SkippedStep} PlanStep
 */

/**
 * Normalizes a repo path to forward slashes so Windows and Linux compare the same.
 * @param {string} file
 */
export function normalizePath(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

/**
 * Splits the output of a `git ... -z` command into paths.
 * @param {string} output
 */
export function parseNullSeparated(output) {
  return output.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Changed files = diff against the base (committed and uncommitted) + untracked files.
 * Sorted and deduplicated so the plan does not depend on git's output order.
 * @param {{ diff: string[], untracked: string[] }} sources
 */
export function collectChanged({ diff, untracked }) {
  return [...new Set([...diff, ...untracked].map(normalizePath))].sort();
}

/**
 * Base ref: the flag wins, then TICKET_BASE, then the merge-base computed by the caller.
 * @param {{ flag?: string, env?: string, mergeBase?: string }} sources
 */
export function resolveBase({ flag, env, mergeBase }) {
  return flag || env || mergeBase || null;
}

/**
 * Reads `--base <ref>` or `--base=<ref>`; throws on a flag with no value.
 * @param {string[]} argv
 * @returns {{ base: string | undefined }}
 */
export function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--base=")) return { base: arg.slice("--base=".length) };
    if (arg === "--base") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--base necesita una referencia de git (por ejemplo --base main).");
      return { base: value };
    }
  }
  return { base: undefined };
}

/**
 * Ordered gates for the changed files. The runner stops at the first one that fails.
 * @param {string[]} changed
 * @returns {PlanStep[]}
 */
export function buildPlan(changed) {
  const code = changed.filter((file) => CODE_FILE.test(file));
  const touchesDatabase = changed.some((file) => file.startsWith("supabase/"));

  /** @type {PlanStep[]} */
  const steps = [{ id: "typecheck", label: "Tipos (tsc, normal y estricto)", command: "npm", args: ["run", "typecheck"] }];

  steps.push(
    code.length > 0
      ? { id: "lint", label: `ESLint sobre ${code.length} archivo(s)`, command: "npx", args: ["eslint", "--no-warn-ignored", ...code] }
      : { id: "lint", label: "ESLint", skipped: "no cambió ningún .ts, .tsx, .mjs ni .js" },
  );
  steps.push(
    code.length > 0
      ? {
          id: "tests",
          label: "Vitest sobre los tests relacionados",
          command: "npx",
          // passWithNoTests: a changed file that no test imports is not a failure.
          args: ["vitest", "related", "--run", "--passWithNoTests", ...code],
        }
      : { id: "tests", label: "Vitest", skipped: "no cambió ningún archivo de código" },
  );
  if (changed.some((file) => ESLINT_SETUP.test(file))) {
    steps.push({ id: "eslint-tests", label: "Pruebas de las reglas de ESLint", command: "npx", args: ["vitest", "run", "eslint"] });
  }
  steps.push(
    touchesDatabase
      ? { id: "database", label: "Pruebas de la base (pgTAP)", command: "supabase", args: ["test", "db"] }
      : { id: "database", label: "Pruebas de la base (pgTAP)", skipped: "no cambió nada bajo supabase/" },
  );
  return steps;
}

/**
 * @param {PlanStep} step
 * @returns {step is SkippedStep}
 */
export function isSkipped(step) {
  return "skipped" in step;
}

/**
 * Phase branch a ticket branch hangs from: `plataforma/t0-1-vitest` -> `plataforma/fase-0`.
 * Returns null when the name does not follow the ticket convention.
 * @param {string} branch
 * @returns {string | null}
 */
export function phaseBranchFor(branch) {
  const match = /^plataforma\/t(\d+)-\d+-[a-z0-9][a-z0-9-]*$/.exec(branch);
  return match ? `plataforma/fase-${match[1]}` : null;
}
