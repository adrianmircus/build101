"use client";

import { useEffect, useState } from "react";
import { useVoiceCommands } from "@/components/student/voice/VoiceCommands";
import { secondaryButton } from "@/components/ui/styles";
import { hasSupports, splitSupports } from "@/lib/solve/supportParts";
import { speechText } from "@/lib/speech/latexSpeech";
import { useVoicePhrase } from "@/lib/speech/useDictation";
import { speakAloud, stopSpeaking } from "@/lib/speech/voice";
import type { VoiceCommand } from "@/lib/voice/commands";

// "Escuchar": reads a text aloud, formulas in words (lib/speech/latexSpeech.ts), with the Rioplatense ElevenLabs voice
// or, without it, the browser's. One voice at a time: starting another one stops this one and resets its button.
export function ListenButton({ text, label = "Escuchar", className = secondaryButton }: { text: string; label?: string; className?: string }) {
  const [playing, setPlaying] = useState(false);
  // Changing exercise or leaving stops it.
  useEffect(() => () => stopSpeaking(), []);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (playing) {
          stopSpeaking();
          return;
        }
        setPlaying(true);
        speakAloud(speechText(text), () => setPlaying(false));
      }}
    >
      <span aria-hidden="true">{playing ? "■" : "🔊"}</span>
      {playing ? "Detener" : label}
    </button>
  );
}

// What the student says to hear the exercise. "leer consigna" is the one on screen; the rest are how it comes out.
const READ_PROMPT = ["leer consigna", "leer la consigna", "lee la consigna", "leeme la consigna", "repetir la consigna"];

// Students who answer with eye gaze can't press "Escuchar": saying «leer consigna» reads the exercise aloud with the
// Rioplatense ElevenLabs voice (the browser's if it isn't available). The microphone stays on while the exercise is on
// screen and only reacts to that phrase. If the student also navigates by voice, it's one more command of the bar.
export function ReadPromptByVoice({ text }: { text: string }) {
  const [reading, setReading] = useState(false);
  const read = () => {
    setReading(true);
    speakAloud(speechText(text), () => setReading(false));
  };
  const voice = useVoicePhrase({ phrases: READ_PROMPT, onHeard: read });
  useVoiceCommands([{ id: "read-prompt", label: "Leer consigna", phrases: READ_PROMPT, run: read }]);
  // Changing exercise or leaving stops the reading.
  useEffect(() => () => stopSpeaking(), []);
  if (!voice.supported) return null;
  return (
    <p
      role="status"
      className={`mb-6 flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-lg ${
        voice.error ? "border-red-700 bg-red-50 text-red-900" : "border-indigo-200 bg-indigo-50 text-indigo-950"
      }`}
    >
      <span aria-hidden="true" className="text-2xl">
        {reading ? "🔊" : "🎤"}
      </span>
      <span>
        {voice.error ??
          (reading ? (
            <span className="font-semibold">Leyendo la consigna…</span>
          ) : voice.listening ? (
            <>
              Decí <span className="font-semibold">«leer consigna»</span> y te la leemos en voz alta.
            </>
          ) : (
            "Prendiendo el micrófono…"
          ))}
      </span>
    </p>
  );
}

const helpButton =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-indigo-700 bg-white px-4 py-2 text-base font-semibold text-indigo-900 transition-colors hover:bg-indigo-50";

// Audio helps for a student with reduced reasoning ("razonamiento disminuido"), like the adapter's: the statement
// and each support of the exercise, one button each. Nothing if the exercise brings no supports.
// The same helps are voice commands for students who navigate by voice (the hook does nothing for the rest).
export function AudioHelps({ text }: { text: string }) {
  const parts = splitSupports(text);
  const say = (t: string) => () => void speakAloud(speechText(t));
  const commands: VoiceCommand[] = !hasSupports(parts)
    ? []
    : [
        ...(parts.statement
          ? [{ id: "help-statement", label: "Escuchar la consigna", phrases: ["escuchar la consigna", "leer la consigna"], run: say(parts.statement) }]
          : []),
        ...parts.guide.map((q, i) => ({
          id: `help-guide-${i + 1}`,
          label: `Pregunta guía ${i + 1}`,
          phrases: [`pregunta guia ${i + 1}`, `escuchar la pregunta guia ${i + 1}`],
          run: say(q),
        })),
        ...(parts.reminder
          ? [{ id: "help-reminder", label: "Escuchar el recordatorio", phrases: ["recordatorio", "escuchar el recordatorio"], run: say(`Recordatorio: ${parts.reminder}`) }]
          : []),
        ...(parts.example
          ? [{ id: "help-example", label: "Escuchar el ejemplo", phrases: ["ejemplo resuelto", "escuchar el ejemplo"], run: say(`Ejemplo resuelto: ${parts.example}`) }]
          : []),
      ];
  useVoiceCommands(commands);
  if (!hasSupports(parts)) return null;
  return (
    <section aria-label="Ayudas de audio" className="mb-6 rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
      <h3 className="text-lg font-bold text-indigo-950">Ayudas de audio</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {parts.statement && (
          <li>
            <ListenButton text={parts.statement} label="Escuchar la consigna" className={helpButton} />
          </li>
        )}
        {parts.guide.map((question, i) => (
          <li key={i}>
            <ListenButton text={question} label={`Pregunta guía ${i + 1}`} className={helpButton} />
          </li>
        ))}
        {parts.reminder && (
          <li>
            <ListenButton text={`Recordatorio: ${parts.reminder}`} label="Escuchar el recordatorio" className={helpButton} />
          </li>
        )}
        {parts.example && (
          <li>
            <ListenButton text={`Ejemplo resuelto: ${parts.example}`} label="Escuchar el ejemplo resuelto" className={helpButton} />
          </li>
        )}
      </ul>
    </section>
  );
}
