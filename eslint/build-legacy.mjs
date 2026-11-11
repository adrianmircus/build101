// Regenerates eslint/legacy.mjs from what ESLint reports today, freezing every file at its current
// numbers so it cannot grow. Run it only to MEASURE a clean slate; the list must only shrink, so
// review the diff before committing.
//   node eslint/build-legacy.mjs
import { writeFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { ESLint } from "eslint";

const SIZE_RULES = new Set(["max-lines", "tiza/function-size", "complexity", "max-depth", "max-params"]);
process.env.ESLINT_NO_LEGACY = "1";

// The number each rule reports, taken from its message.
const READERS = {
  "max-depth": /\((\d+)\)/,
  complexity: /complexity of (\d+)/,
  "max-params": /has too many parameters \((\d+)\)/,
  "max-lines": /has too many lines \((\d+)\)/,
  "tiza/function-size": /has (\d+) lines/,
};

const valueOf = (message) => Number(READERS[message.ruleId].exec(message.message)?.[1]);

function freeze(file, messages, base) {
  const frozen = {};
  for (const m of messages) {
    if (!SIZE_RULES.has(m.ruleId)) continue;
    const value = valueOf(m);
    if (!Number.isInteger(value)) throw new Error(`${file}: cannot read ${m.ruleId} from "${m.message}"`);
    if (m.ruleId !== "tiza/function-size") {
      frozen[m.ruleId] = Math.max(frozen[m.ruleId] ?? 0, value);
      continue;
    }
    const key = m.message.startsWith("Component") ? "componentMax" : "max";
    frozen[m.ruleId] ??= { ...base };
    frozen[m.ruleId][key] = Math.max(frozen[m.ruleId][key] ?? 0, value);
  }
  return frozen;
}

const results = await new ESLint().lintFiles(["."]);
const entries = [];
for (const r of results) {
  const file = relative(process.cwd(), r.filePath).split(sep).join("/");
  const base = file.endsWith(".tsx") ? { max: 40, componentMax: 150 } : { max: 40, componentMax: 40 };
  const frozen = freeze(file, r.messages, base);
  if (Object.keys(frozen).length > 0) entries.push([file, frozen]);
}
entries.sort(([a], [b]) => a.localeCompare(b));

const body = entries.map(([file, rules]) => `  ${JSON.stringify(file)}: ${JSON.stringify(rules)},`).join("\n");
const header = `// Files that exceed a size or complexity limit today. Each one is frozen at its current numbers
// (not switched off), so it cannot grow. This list can only shrink: the ticket that touches one of
// these files splits it and deletes its entry. Never add a file here; split it instead.
// Regenerate only with eslint/build-legacy.mjs; eslint/legacy.test.ts fails on entries that no
// longer apply.
`;
const footer = `
export const legacyFiles = Object.keys(legacyRules);

const blank = { skipBlankLines: true, skipComments: true };

// Turns a frozen value into the rule configuration that enforces it.
function ruleConfig(rule, value) {
  if (rule === "max-lines") return ["error", { max: value, ...blank }];
  return ["error", value];
}

export const legacy = Object.entries(legacyRules).map(([file, rules]) => ({
  files: [file],
  rules: Object.fromEntries(Object.entries(rules).map(([rule, value]) => [rule, ruleConfig(rule, value)])),
}));
`;
writeFileSync("eslint/legacy.mjs", `${header}\nconst legacyRules = {\n${body}\n};\n${footer}`);
console.log(`${entries.length} files in the exception list`);
