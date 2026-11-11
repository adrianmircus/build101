import { ESLint } from "eslint";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { legacy, legacyFiles } from "./legacy.mjs";
import { sizeRules } from "./sizes.mjs";

const root = resolve(__dirname, "..");

describe("legacy exception list", () => {
  it.each(legacyFiles)("%s still exists (delete the entry when a file is split or removed)", (file) => {
    expect(existsSync(resolve(root, file))).toBe(true);
  });
});

// Entries are frozen limits. If a file now passes the normal limit for a rule, the entry is dead
// weight and has to go, otherwise the list stops shrinking.
describe("legacy entries still apply", () => {
  const ruleIdsByFile = new Map<string, Set<string>>();

  beforeAll(async () => {
    const forFiles = (tsx: boolean) => legacyFiles.filter((f) => f.endsWith(".tsx") === tsx);
    const eslint = new ESLint({
      cwd: root,
      overrideConfig: [
        { files: forFiles(false), rules: sizeRules(40) },
        { files: forFiles(true), rules: sizeRules(150) },
      ],
    });
    for (const r of await eslint.lintFiles(legacyFiles)) {
      const file = r.filePath.slice(root.length + 1).replaceAll("\\", "/");
      ruleIdsByFile.set(file, new Set(r.messages.flatMap((m) => (m.ruleId === null ? [] : [m.ruleId]))));
    }
  }, 120_000);

  const entries = legacy.flatMap((c) => Object.keys(c.rules).map((rule) => [String(c.files[0]), rule] as const));

  it.each(entries)("%s still breaks %s with the normal limit", (file, rule) => {
    const message = `${file} no longer breaks ${rule} with the normal limit: delete that rule from eslint/legacy.mjs.`;
    expect(ruleIdsByFile.get(file)?.has(rule), message).toBe(true);
  });
});
