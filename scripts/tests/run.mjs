// Corre todos los scripts/tests/test-*.ts, uno por uno, y falla si falla alguno.
// Un test nuevo no se agrega en package.json: alcanza con que se llame test-*.ts.
// Si un test necesita una condición de import, la pone en su comentario «Correr con:»
// (por ejemplo «npx tsx --conditions=react-server …») y el runner la pasa.
import { globSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = globSync("scripts/tests/test-*.ts").sort();
const failed = [];

for (const file of files) {
  const header = readFileSync(file, "utf8").split("\n", 5).join("\n");
  const conditions = [...header.matchAll(/--conditions=(\S+)/g)].map((m) => `--conditions=${m[1]}`);
  console.log(`\n▶ ${file}`);
  const { status } = spawnSync(process.execPath, [...conditions, "--import", "tsx", file], { stdio: "inherit" });
  if (status !== 0) failed.push(file);
}

console.log(`\n${files.length - failed.length}/${files.length} archivos de tests pasaron`);
if (failed.length > 0) {
  console.log(`Fallaron: ${failed.join(", ")}`);
  process.exit(1);
}
