// Helpers del navegador: mandar el práctico, leer el stream de eventos y armar el texto para escuchar.
import type { AdaptEvent } from "./adapt-pipeline";
import type { AdaptedItem, Adjustment, MathObject } from "./adapt-schemas";
import { speakMath } from "./speech";
import { uploadIssue } from "./upload";

export async function runAdapt(
  input: { files: File[]; text?: string; ajustes?: Adjustment[]; keepItems?: string[] },
  onEvent: (e: AdaptEvent) => void,
) {
  // Se controla antes de subir: pasado el tope, Vercel corta con un 413 sin mensaje para el profe.
  const invalid = uploadIssue(input.files);
  if (invalid) {
    onEvent({ stage: "error", message: invalid });
    return;
  }
  const form = new FormData();
  for (const f of input.files) form.append("files", f);
  if (input.text) form.append("text", input.text);
  for (const a of input.ajustes ?? []) form.append("ajustes", a);
  for (const id of input.keepItems ?? []) form.append("items", id);

  const res = await fetch("/api/adapt", { method: "POST", body: form });
  if (res.status === 401) {
    onEvent({ stage: "error", message: "Tu sesión venció. Volvé a ingresar como profe." });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ stage: "error", message: "No pudimos conectarnos con el servidor." });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}

// Accesibilidad de las fórmulas: KaTeX con MathML y sin aria-label ni role="math" encima. La lectura en español de
// speakMath va aparte, en un botón de audio al lado de la fórmula (sin autoplay y con pausa). Si fuera aria-label,
// el lector de pantalla leería ese texto en lugar del MathML y NVDA con MathCAT ya no podría navegar la fórmula
// ni pasarla a braille.
export function formulaAudio(m: MathObject, n: number): { buttonLabel: string; text: string } {
  return { buttonLabel: `Escuchar la fórmula ${n}`, text: speakMath(m.mathjs) };
}

// Lee un texto con la voz del navegador. Se llama solo desde un clic (nada de autoplay) y devuelve pausa y stop.
// onEnd avisa cuando termina o se corta, para que el botón vuelva a "Escuchar".
export function speak(text: string, onEnd?: () => void): { pause(): void; resume(): void; stop(): void } {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  const voices = synth.getVoices();
  const voice =
    voices.find((v) => v.lang === "es-UY") ?? voices.find((v) => v.lang === "es-419" || v.lang === "es-US") ?? voices.find((v) => v.lang.startsWith("es"));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "es-UY";
  synth.speak(u);
  return { pause: () => synth.pause(), resume: () => synth.resume(), stop: () => synth.cancel() };
}

// Texto del ejercicio con cada marcador reemplazado por su lectura en voz alta, para el botón "Escuchar" (speak).
export function spokenItem(item: AdaptedItem, math: MathObject[]): string {
  const say = (t: string) =>
    t.replace(/\*\*/g, "").replace(/\{\{(m\d+)\}\}/g, (_, id: string) => {
      const m = math.find((x) => x.id === id);
      return m ? speakMath(m.mathjs) : "";
    });
  const s = item.support;
  const support = s
    ? [
        ...s.guide.map((g, i) => `Pregunta guía ${i + 1}: ${say(g)}`),
        s.reminder ? `Recordatorio: ${say(s.reminder)}` : "",
        s.example.statement ? `Ejemplo resuelto: ${s.example.statement}. ${s.example.steps.map((m) => speakMath(m)).join(". ")}` : "",
      ]
    : [];
  return [say(item.text), ...item.steps.map((s, i) => `Paso ${i + 1}: ${say(s)}`), item.figure ? `Figura: ${say(item.figure)}` : "", ...support]
    .filter(Boolean)
    .join(". ");
}
