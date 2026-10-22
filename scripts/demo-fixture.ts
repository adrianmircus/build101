// Generates the demo's precomputed versions (data/demo/limites.json) with the real agent, once.
// In the demo nothing calls the AI, but nothing is written by hand either: these are the agent's own answers.
// Run with: npx tsx --conditions=react-server --env-file=.env.local scripts/demo-fixture.ts
// (react-server so "server-only" lets lib/agent load outside Next.js.)
import fs from "node:fs";
import path from "node:path";
import { generateVersion } from "../lib/agent/generate";
import type { GenerationResponse } from "../lib/contract";
import { DEMO_EXAMPLE, DEMO_GROUP_ID } from "../lib/demo/example";
import { seed } from "../lib/groups/seed";
import { groupByProfiles, topInterests } from "../lib/groups/versions";

const OUT = path.join(process.cwd(), "data", "demo", "limites.json");

async function main() {
  const group = seed().groups.find((g) => g.id === DEMO_GROUP_ID)!;
  // The same versions and interests NewAssessment builds for this group, so the requests match.
  const versions = groupByProfiles(group.students).map((v) => ({
    profiles: v.profiles,
    interests: topInterests(group.students.filter((s) => v.studentIds.includes(s.id))),
  }));
  const results: Record<string, GenerationResponse> = {};
  for (const v of versions) {
    const key = v.profiles.join("+");
    console.log(`Generando ${key} (gustos: ${v.interests.join(", ") || "ninguno"})…`);
    results[key] = await generateVersion({ ...DEMO_EXAMPLE, profiles: v.profiles, interests: v.interests });
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const fixture = { ...DEMO_EXAMPLE, generatedAt: new Date().toISOString(), versions: results };
  fs.writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Listo: ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
