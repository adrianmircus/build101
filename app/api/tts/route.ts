// POST { text } → audio/mpeg con la voz rioplatense de ElevenLabs. La usan el profe (Escuchar en /adaptar) y los
// estudiantes (relectura del dictado), así que alcanza con cualquier sesión.
// 503 si ElevenLabs no está configurado o falla: el navegador lee con su propia voz.
import { MAX_TTS_CHARS, synthesize, TtsUnavailable } from "@/lib/speech/elevenlabs";
import { readSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  if (!(await readSession())) return Response.json({ error: "Tu sesión venció. Volvé a ingresar." }, { status: 401 });

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
