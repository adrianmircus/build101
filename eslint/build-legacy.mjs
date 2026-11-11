// Regenerates eslint/legacy.mjs from what ESLint reports today. Run it only to MEASURE a clean
// slate; the list must only shrink, so review the diff before committing.
//   node eslint/build-legacy.mjs
import { writeFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { ESLint } from "eslint";

const SIZE_RULES = new Set(["max-lines", "tiza/function-size", "complexity", "max-depth", "max-params"]);

process.env.ESLINT_NO_LEGACY = "1";
const results = await new ESLint().lintFiles(["."]);
const entries = [];
for (const r of results) {
  const rules = [...new Set(r.messages.map((m) => m.ruleId).filter((id) => SIZE_RULES.has(id)))].sort();
  if (rules.length > 0) entries.push([relative(process.cwd(), r.filePath).split(sep).join("/"), rules]);
}
entries.sort(([a], [b]) => a.localeCompare(b));

const body = entries
  .map(([file, rules]) => `  ${JSON.stringify(file)}: [${rules.map((r) => JSON.stringify(r)).join(", ")}],`)
  .join("\n");
const header = `// Files that exceed a size or complexity limit today, with only the rules each one breaks.
// This list can only shrink: the ticket that touches one of these files splits it and deletes its
// entry. Never add a file here; split it instead. Regenerate only with eslint/build-legacy.mjs.
`;
const footer = `
export const legacyFiles = Object.keys(legacyRules);

export const legacy = Object.entries(legacyRules).map(([file, rules]) => ({
  files: [file],
  rules: Object.fromEntries(rules.map((rule) => [rule, "off"])),
}));
`;
writeFileSync("eslint/legacy.mjs", `${header}\nconst legacyRules = {\n${body}\n};\n${footer}`);
console.log(`${entries.length} files in the exception list`);
