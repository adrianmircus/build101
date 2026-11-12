// POST { text } → audio/mpeg con la voz rioplatense de ElevenLabs. La usan el profe y los
// estudiantes (relectura del dictado), así que alcanza con cualquier sesión real (staff o estudiante).
// La demo entra, pero no gasta: se le responde 503 y el navegador lee con su propia voz.
// 503 si ElevenLabs no está configurado o falla: el navegador lee con su propia voz.
import { readDemoSession } from "@/app/demo/session";
import { getActor } from "@/lib/server/auth/actor";
import { MAX_TTS_CHARS, synthesize, TtsUnavailable } from "@/lib/speech/elevenlabs";

export const maxDuration = 30;

export async function POST(req: Request) {
  // The cookie of the demo opens the demo and nothing else: here it only gets the browser's own voice. (proxy.ts drops it
  // when a real session is open, so a real person never lands in this branch.)
  if (await readDemoSession()) return Response.json({ error: "En la demo la lectura usa la voz de tu navegador." }, { status: 503 });
  if (!(await getActor())) return Response.json({ error: "Tu sesión venció. Volvé a ingresar." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "No hay texto para leer." }, { status: 400 });
  if (text.length > MAX_TTS_CHARS) return Response.json({ error: "El texto es muy largo para leerlo de una vez." }, { status: 413 });

  try {
    const audio = await synthesize(text);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    if (!(e instanceof TtsUnavailable)) console.error("tts", e);
    else if (process.env.ELEVENLABS_API_KEY) console.error("tts", e.message);
    return Response.json({ error: "La voz no está disponible." }, { status: 503 });
  }
}
