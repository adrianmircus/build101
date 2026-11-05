// Records the landing's "Así suena un práctico" audio once, with the same ElevenLabs voice the app uses for
// "Escuchar". The landing never calls the API: it plays public/landing/consigna.mp3 and shows the exact words read.
// Run with: npx tsx --conditions=react-server --env-file=.env.local scripts/landing-audio.ts
// (react-server so "server-only" lets lib/speech load outside Next.js.)
import fs from "node:fs";
import path from "node:path";
import { LANDING_EXAMPLE } from "../lib/landing/example";
import { synthesize } from "../lib/speech/elevenlabs";
import { speechText } from "../lib/speech/latexSpeech";

async function main() {
  const text = speechText(LANDING_EXAMPLE.original);
  console.log(`Grabando: ${text}`);
  const audio = await synthesize(text);
  const mp3 = path.join(process.cwd(), "public", "landing", "consigna.mp3");
  fs.mkdirSync(path.dirname(mp3), { recursive: true });
  fs.writeFileSync(mp3, Buffer.from(audio));
  // The transcript next to the player must be exactly what was recorded.
  const transcript = path.join(process.cwd(), "data", "landing", "audio.json");
  fs.writeFileSync(transcript, `${JSON.stringify({ text, recordedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`Listo: ${path.relative(process.cwd(), mp3)} y ${path.relative(process.cwd(), transcript)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
