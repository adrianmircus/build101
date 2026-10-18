"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceCommands } from "@/components/student/voice/VoiceCommands";
import { secondaryButton } from "@/components/ui/styles";
import { hasSupports, splitSupports } from "@/lib/solve/supportParts";
import { speechText } from "@/lib/speech/latexSpeech";
import { useHandsFreeListening } from "@/lib/speech/useDictation";
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

// The phrases for the voice commands bar. Hands-free it's looser: see asksForPrompt.
const READ_PROMPT = ["leer consigna", "leer la consigna", "lee la consigna", "leeme la consigna", "repetir la consigna"];

// Hands-free, anything with "consigna" counts ("leer consigna", "leé la consigna", "la consigna", "consignas"): the
// browser writes the same phrase in different ways, and an exact match missed it. Also "leer el ejercicio".
export function asksForPrompt(heard: string): boolean {
  return /\bconsign/.test(heard) || /\blee(r|me)? (el )?ejercicio\b/.test(heard);
}

// Chrome only plays sound once the page got a click or a key (the login gives it). After a reload it's blocked, both
// the ElevenLabs voice and the browser's: someone helping has to tap the screen once.
function canPlaySound(): boolean {
  return typeof navigator === "undefined" || !navigator.userActivation || navigator.userActivation.hasBeenActive;
}

// Students who answer with eye gaze can't press "Escuchar": saying «leer consigna» reads the exercise aloud with the
// Rioplatense ElevenLabs voice (the browser's if it isn't available). The microphone stays on while the exercise is on
// screen and shows what it heard. If the student also navigates by voice, it's one more command of the bar.
export function ReadPromptByVoice({ text }: { text: string }) {
  const [reading, setReading] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(() => !canPlaySound());
  // Asked for while the sound was blocked: it plays on the helper's first tap. The ref is what the tap reads.
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });

  // The last phrase heard from the speakers arrives a moment after the audio ends: the pause lasts a bit longer.
  const play = useCallback(() => {
    setReading(true);
    speakAloud(speechText(textRef.current), () => window.setTimeout(() => setReading(false), 1500));
  }, []);
  const read = () => {
    if (canPlaySound()) return play();
    pendingRef.current = true;
    setSoundBlocked(true);
    setPending(true);
  };

  useEffect(() => {
    if (!soundBlocked) return;
    const unlock = () => {
      setSoundBlocked(false);
      setPending(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        play();
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundBlocked, play]);

  const voice = useHandsFreeListening({ onFinal: (heard) => asksForPrompt(heard) && read(), paused: reading });
  useVoiceCommands([{ id: "read-prompt", label: "Leer consigna", phrases: READ_PROMPT, run: read }]);
  // Changing exercise or leaving stops the reading.
  useEffect(() => () => stopSpeaking(), []);
  if (!voice.supported) return null;

  const warning = Boolean(voice.error) || soundBlocked;
  return (
    <div
      role="status"
      className={`mb-6 flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-lg ${
        voice.error
          ? "border-red-700 bg-red-50 text-red-900"
          : warning
            ? "border-amber-600 bg-amber-50 text-amber-950"
            : "border-indigo-200 bg-indigo-50 text-indigo-950"
      }`}
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {reading ? "🔊" : "🎤"}
      </span>
      <div className="space-y-1">
        <p>
          {voice.error ??
            (reading ? (
              <span className="font-semibold">Leyendo la consigna…</span>
            ) : soundBlocked ? (
              <>
                <span className="font-semibold">
                  {pending ? "Te escuché, pero el navegador no deja sonar todavía." : "El sonido está bloqueado."}
                </span>{" "}
                Quien te ayuda tiene que tocar la pantalla una vez{pending ? " y la leemos." : "."}
              </>
            ) : voice.listening ? (
              <>
                Decí <span className="font-semibold">«leer consigna»</span> y te la leemos en voz alta.
              </>
            ) : (
              "Prendiendo el micrófono… Si el navegador pide permiso, quien te ayuda tiene que tocar «Permitir»."
            ))}
        </p>
        {voice.listening && voice.heard && !reading && (
          <p className="text-base text-slate-700">Escuché: «{voice.heard}»</p>
        )}
      </div>
    </div>
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
