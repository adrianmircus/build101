// Gates of a ticket: runs only what the ticket's changed files require, and stops at the first failure.
// Usage: npm run check:ticket [-- --base <ref>]   (base also from TICKET_BASE, else merge-base with main)
import { spawnSync } from "node:child_process";
import { buildPlan, collectChanged, isSkipped, parseArgs, parseNullSeparated, phaseBranchFor, resolveBase } from "./check-ticket/plan.mjs";

const isWindows = process.platform === "win32";

// On Windows npm/npx are .cmd shims that need a shell, so arguments must be quoted by hand.
const quote = (arg) => (isWindows && /[^\w@%+=:,./\\-]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);

function run(command, args, options = {}) {
  // One command string with shell:true on Windows: passing an args array there is deprecated (DEP0190).
  if (isWindows) return spawnSync([command, ...args.map(quote)].join(" "), { encoding: "utf8", shell: true, ...options });
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function git(args) {
  const result = run("git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} falló: ${(result.stderr || "").trim()}`);
  return result.stdout;
}

// A ticket branch is cut from its phase branch, so that is the right base; main is the fallback.
function defaultBaseRef() {
  const phase = phaseBranchFor(git(["rev-parse", "--abbrev-ref", "HEAD"]).trim());
  const exists = phase && run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${phase}`], { stdio: "ignore" }).status === 0;
  return exists ? phase : "main";
}

function findBase() {
  const { base: flag } = parseArgs(process.argv.slice(2));
  const env = process.env.TICKET_BASE || undefined;
  const mergeBase = flag || env ? undefined : git(["merge-base", "HEAD", defaultBaseRef()]).trim();
  const base = resolveBase({ flag, env, mergeBase });
  if (!base) throw new Error("No se pudo calcular la base del diff. Pasá --base <ref> o definí TICKET_BASE.");
  return base;
}

function changedFiles(base) {
  // diff-filter=d: deleted files cannot be linted or tested.
  const diff = parseNullSeparated(git(["diff", "--name-only", "-z", "--diff-filter=d", base]));
  const untracked = parseNullSeparated(git(["ls-files", "--others", "--exclude-standard", "-z"]));
  return collectChanged({ diff, untracked });
}

function hasSupabaseCli() {
  return run("supabase", ["--version"], { stdio: "ignore" }).status === 0;
}

function main() {
  const base = findBase();
  const changed = changedFiles(base);
  const plan = buildPlan(changed);
  console.log(`Base: ${base}. Archivos cambiados: ${changed.length}.`);

  const ran = [];
  for (const step of plan) {
    if (isSkipped(step)) {
      console.log(`\n- Salteado: ${step.label} (${step.skipped})`);
      continue;
    }
    console.log(`\n> ${step.label}\n  $ ${[step.command, ...step.args].join(" ")}`);
    if (step.id === "database" && !hasSupabaseCli()) {
      console.error("\nFALLA: cambiaste archivos bajo supabase/ pero no está instalado el CLI de Supabase. Instalalo (https://supabase.com/docs/guides/cli) y volvé a correr.");
      process.exit(1);
    }
    const { status } = run(step.command, step.args, { stdio: "inherit" });
    if (status !== 0) {
      console.error(`\nFALLA: ${step.label}. Se detuvo acá; no corrieron los pasos que siguen.`);
      process.exit(1);
    }
    ran.push(step.label);
  }
  console.log(`\nTodo en verde. Corrió: ${ran.join("; ")}.`);
}

try {
  main();
} catch (error) {
  console.error(`\nFALLA: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
