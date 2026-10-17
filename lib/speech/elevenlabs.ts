import "server-only";

// Texto a voz con ElevenLabs. La clave queda en el servidor: el navegador pide el audio a /api/tts.
// Variables (.env.local): ELEVENLABS_API_KEY (obligatoria), ELEVENLABS_VOICE_ID y ELEVENLABS_MODEL (opcionales).

// Tomás, de la Voice Library de ElevenLabs: voz masculina rioplatense ("Argentina & Uruguaya"). Si la cuenta no la
// tiene en "My Voices", hay que agregarla desde la Voice Library o poner otra en ELEVENLABS_VOICE_ID.
export const DEFAULT_VOICE_ID = "QK4xDwo9ESPHA4JNUpX3";
// El modelo multilingüe mantiene el acento de la voz en español. eleven_flash_v2_5 responde más rápido.
export const DEFAULT_MODEL = "eleven_multilingual_v2";
// Tope por pedido: un ejercicio con sus pasos y apoyos entra holgado; un texto más largo no sale de un clic de "Escuchar".
export const MAX_TTS_CHARS = 2500;

export class TtsUnavailable extends Error {}

export const ttsConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);

// Los mismos botones se tocan muchas veces en una clase (o en una demo): el audio ya generado no se vuelve a pagar.
const cache = new Map<string, ArrayBuffer>();
const CACHE_SIZE = 64;

export async function synthesize(text: string): Promise<ArrayBuffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TtsUnavailable("Falta ELEVENLABS_API_KEY en .env.local");
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;

  const id = `${voice}|${model}|${text}`;
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id); // vuelve al final: el más usado es el último en salir
    cache.set(id, hit);
    return hit;
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new TtsUnavailable(`ElevenLabs respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const audio = await res.arrayBuffer();
  cache.set(id, audio);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return audio;
}
