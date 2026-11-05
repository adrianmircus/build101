// Generates precomputed versions with the real agent, once. Nothing that reads them calls the AI, but nothing
// is written by hand either: these are the agent's own answers.
// Demo (data/demo/limites.json):    npx tsx --conditions=react-server --env-file=.env.local scripts/demo-fixture.ts
// Landing (data/landing/ejemplo.json): the same command with --landing at the end.
// (react-server so "server-only" lets lib/agent load outside Next.js.)
import fs from "node:fs";
import path from "node:path";
import { generateVersion } from "../lib/agent/generate";
import type { GenerationResponse } from "../lib/contract";
import { DEMO_EXAMPLE, DEMO_GROUP_ID } from "../lib/demo/example";
import { seed } from "../lib/groups/seed";
import { groupByProfiles, topInterests } from "../lib/groups/versions";
import { LANDING_EXAMPLE, LANDING_INTERESTS, LANDING_PROFILES, LANDING_SUPPORTS } from "../lib/landing/example";

async function demo() {
  const out = path.join(process.cwd(), "data", "demo", "limites.json");
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
  write(out, { ...DEMO_EXAMPLE, generatedAt: new Date().toISOString(), versions: results });
}

// One version per profile on its own, with the interests and supports recorded next to them.
async function landing() {
  const out = path.join(process.cwd(), "data", "landing", "ejemplo.json");
  const results: Record<string, GenerationResponse> = {};
  for (const profile of LANDING_PROFILES) {
    console.log(`Generando ${profile}…`);
    results[profile] = await generateVersion({
      ...LANDING_EXAMPLE,
      profiles: [profile],
      interests: LANDING_INTERESTS,
      supports: LANDING_SUPPORTS,
    });
  }
  write(out, {
    ...LANDING_EXAMPLE,
    interests: LANDING_INTERESTS,
    supports: LANDING_SUPPORTS,
    generatedAt: new Date().toISOString(),
    versions: results,
  });
}

function write(out: string, fixture: object) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Listo: ${path.relative(process.cwd(), out)}`);
}

(process.argv.includes("--landing") ? landing() : demo()).catch((e) => {
  console.error(e);
  process.exit(1);
});
