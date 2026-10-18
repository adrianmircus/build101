"use client";

import { useEffect, useState } from "react";
import { useVoiceCommands } from "@/components/student/voice/VoiceCommands";
import { AiProgress } from "@/components/ui/AiProgress";
import { FunctionGraph } from "@/components/ui/FunctionGraph";
import { approveButton, field, primaryButton, secondaryButton } from "@/components/ui/styles";
import type { TranscribeResponse } from "@/lib/contract";
import type { Answer } from "@/lib/groups/types";
import { transcribe } from "@/lib/solve/transcribe";
import { speak, useDictation } from "@/lib/speech/useDictation";
import type { VoiceCommand } from "@/lib/voice/commands";
import { TypedAnswer } from "./TypedAnswer";

type Status = { kind: "idle" } | { kind: "converting" } | { kind: "error"; message: string };

// Dictating the answer: the browser hears it, the AI writes it in notation without correcting it,
// and nothing is saved until the student confirms what the AI understood.
export function DictationAnswer({
  id,
  exercise,
  saved,
  onSave,
  disabled,
}: {
  id: string;
  exercise: string;
  saved: Answer | null;
  onSave: (answer: Answer | null) => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [proposal, setProposal] = useState<TranscribeResponse | null>(null);
  // What the student fixed by keyboard over the proposal; null while they don't edit it.
  const [edited, setEdited] = useState<string | null>(null);
  // The microphone failed or was denied and the student chose to type instead. It stays until they leave the exercise.
  const [typing, setTyping] = useState(false);

  // When the AI's proposal shows up, focus goes to its question so screen readers read it right away.
  useEffect(() => {
    if (proposal) document.getElementById(`${id}-proposal`)?.focus();
  }, [proposal, id]);

  async function convert(transcript: string) {
    if (!transcript.trim()) return;
    setStatus({ kind: "converting" });
    try {
      setProposal(await transcribe({ exercise, transcript }));
      setEdited(null);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "No pudimos pasar tu respuesta a notación." });
    }
  }

  // When the student stops dictating, what was heard goes straight to the AI.
  const dictation = useDictation({ onEnd: (transcript) => void convert(transcript) });

  function discard() {
    dictation.reset();
    setProposal(null);
    setEdited(null);
    setStatus({ kind: "idle" });
  }

  function confirm() {
    if (!proposal) return;
    const text = (edited ?? proposal.answer).trim();
    if (!text) return;
    // The graph comes from what they dictated: if they fixed the text by keyboard it may not match anymore, so it's left out.
    const graph = edited === null ? proposal.graph : undefined;
    onSave({ text, mode: "voice", transcript: dictation.transcript, ...(graph ? { graph } : {}) });
    discard();
  }

  // Voice commands for what the buttons below do. Stopping the dictation stays on the button: a spoken
  // "stop" word would end up inside the answer.
  const commands: VoiceCommand[] = [];
  if (!disabled && dictation.supported && !dictation.listening && status.kind !== "converting") {
    if (proposal) {
      const answer = edited ?? proposal.answer;
      if (answer.trim()) commands.push({ id: "answer-save", label: "Sí, guardar", phrases: ["si guardar", "guardar", "guardala", "esta bien"], run: confirm });
      commands.push(
        { id: "answer-redo", label: "Volver a dictar", phrases: ["volver a dictar", "dictar de nuevo", "otra vez"], run: () => { discard(); dictation.start(); } },
        { id: "answer-listen", label: "Escuchar", phrases: ["escuchar", "leer la respuesta", "leemela"], run: () => speak(edited ?? proposal.readback) },
      );
      if (edited === null) {
        commands.push({
          id: "answer-keyboard",
          label: "Corregir con el teclado",
          phrases: ["corregir con el teclado", "corregir", "teclado"],
          run: () => {
            setEdited(proposal.answer);
            setTimeout(() => document.getElementById(`${id}-edit`)?.focus());
          },
        });
      }
    } else {
      commands.push({
        id: "answer-dictate",
        label: saved ? "Dictar de nuevo la respuesta" : "Dictar respuesta",
        phrases: ["dictar respuesta", "dictar", "responder", "quiero responder", "dictar de nuevo"],
        run: dictation.start,
      });
      if (saved) {
        commands.push(
          { id: "answer-listen", label: "Escuchar mi respuesta", phrases: ["escuchar", "escuchar mi respuesta", "leer mi respuesta"], run: () => speak(saved.text) },
          { id: "answer-delete", label: "Borrar respuesta", phrases: ["borrar respuesta", "borrar mi respuesta"], run: () => onSave(null) },
        );
      }
    }
  }
  useVoiceCommands(commands);

  if (!dictation.supported) {
    return (
      <div className="space-y-4">
        <p role="note" className="rounded-lg border-2 border-amber-600 bg-amber-50 px-4 py-3 text-lg text-amber-950">
          Este navegador no permite dictar. Para responder con la voz, abrí la plataforma en Chrome o Edge. Mientras
          tanto, podés escribir tu respuesta.
        </p>
        <TypedAnswer
          id={id}
          value={saved?.text ?? ""}
          disabled={disabled}
          onChange={(text) => onSave(text ? { text, mode: "typed" } : null)}
        />
      </div>
    );
  }

  const heard = `${dictation.transcript} ${dictation.interim}`.trim();
  const busy = dictation.listening || status.kind === "converting";

  return (
    <div className="space-y-5">
      {saved && (
        <section aria-labelledby={`${id}-saved`} className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 p-4 sm:p-5">
          <h3 id={`${id}-saved`} className="text-lg font-semibold text-emerald-900">
            ✓ Tu respuesta guardada
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-2xl leading-relaxed">{saved.text}</p>
          {saved.graph && (
            <div className="mt-3">
              <FunctionGraph spec={saved.graph} />
            </div>
          )}
          {!disabled && (
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" className={secondaryButton} onClick={() => speak(saved.text)}>
                Escuchar
              </button>
              <button type="button" className={secondaryButton} onClick={() => onSave(null)}>
                Borrar respuesta
              </button>
            </div>
          )}
        </section>
      )}

      {!disabled && !proposal && (
        <div className="space-y-4">
          <p className="text-lg text-slate-800">
            {saved
              ? "Si querés cambiarla, dictá la respuesta de nuevo."
              : "Tocá el botón y decí tu respuesta en voz alta, con el desarrollo si lo hay. Cuando termines, tocá de nuevo."}
          </p>
          <button
            type="button"
            className={`${dictation.listening ? "inline-flex min-h-16 items-center justify-center gap-3 rounded-xl bg-red-700 px-8 py-4 text-2xl font-bold text-white hover:bg-red-800" : `${primaryButton} min-h-16 px-8 text-2xl`}`}
            disabled={status.kind === "converting"}
            onClick={dictation.listening ? dictation.stop : dictation.start}
          >
            {dictation.listening ? (
              <>
                <span aria-hidden="true" className="size-4 rounded-full bg-white motion-safe:animate-pulse" />
                Terminar de dictar
              </>
            ) : (
              <>
                <span aria-hidden="true">🎤</span>
                {dictation.transcript ? "Seguir dictando" : "Dictar respuesta"}
              </>
            )}
          </button>

          <div
            aria-live="polite"
            className={`min-h-24 rounded-2xl border-2 px-5 py-4 text-2xl leading-relaxed ${
              dictation.listening ? "border-red-700 bg-white" : "border-slate-200 bg-slate-50"
            }`}
          >
            {heard ? (
              <>
                <span className="sr-only">Escuchamos: </span>
                {dictation.transcript} <span className="text-slate-500">{dictation.interim}</span>
              </>
            ) : (
              <span className="text-lg text-slate-600">
                {dictation.listening ? "Te escuchamos…" : "Acá vas a ver lo que vamos escuchando."}
              </span>
            )}
          </div>

          {status.kind === "converting" && (
            <AiProgress
              title="Pasando tu respuesta a notación"
              seconds={6}
              steps={["Escuchando lo que dijiste", "Pasándolo a notación matemática"]}
              compact
            />
          )}
          {dictation.error && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-lg font-semibold text-red-800">
                {dictation.error}
              </p>
              {!typing && (
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    setTyping(true);
                    setTimeout(() => document.getElementById(`${id}-typed`)?.focus());
                  }}
                >
                  Escribir la respuesta
                </button>
              )}
            </div>
          )}
          {typing && (
            // Same as when the browser can't dictate: what they type saves on each change.
            <TypedAnswer
              id={`${id}-typed`}
              value={saved?.mode === "typed" ? saved.text : ""}
              onChange={(text) => onSave(text ? { text, mode: "typed" } : null)}
            />
          )}
          {status.kind === "error" && (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p className="text-lg font-semibold text-red-800">{status.message}</p>
              <button type="button" className={secondaryButton} onClick={() => void convert(dictation.transcript)}>
                Reintentar
              </button>
            </div>
          )}
          {dictation.transcript && !busy && (
            <button type="button" className={secondaryButton} onClick={discard}>
              Borrar lo dictado
            </button>
          )}
        </div>
      )}

      {!disabled && proposal && (
        // The student's approval: nothing is saved until they confirm.
        <section aria-labelledby={`${id}-proposal`} className="rounded-2xl border-2 border-amber-600 bg-amber-50 p-4 sm:p-6">
          <h3 id={`${id}-proposal`} tabIndex={-1} className="text-xl font-bold text-amber-950 outline-offset-4">
            ¿Es esto lo que dijiste?
          </h3>
          {proposal.answer ? (
            <p className="mt-3 whitespace-pre-wrap rounded-xl border-2 border-amber-600 bg-white px-5 py-4 text-3xl leading-relaxed">
              {edited ?? proposal.answer}
            </p>
          ) : (
            <p className="mt-3 text-lg">No encontramos una respuesta en lo que dictaste.</p>
          )}
          {proposal.graph &&
            (edited === null ? (
              <div className="mt-4">
                <p className="mb-2 text-lg font-semibold">Así queda tu gráfica</p>
                <FunctionGraph spec={proposal.graph} />
              </div>
            ) : (
              <p className="mt-4 text-lg">
                La gráfica se arma con lo que dictás: si corregís con el teclado, no se guarda. Para tenerla, volvé a dictar.
              </p>
            ))}
          {proposal.doubts.length > 0 && (
            <div className="mt-4">
              <p className="text-lg font-semibold">Fijate en esto:</p>
              <ul className="mt-1 list-disc space-y-1 pl-6 text-lg">
                {proposal.doubts.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          {edited !== null && (
            <div className="mt-4">
              <label htmlFor={`${id}-edit`} className="mb-2 block text-lg font-semibold">
                Corregí con el teclado
              </label>
              <textarea
                id={`${id}-edit`}
                className={`${field} min-h-28 text-xl`}
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
              />
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className={approveButton}
              disabled={!(edited ?? proposal.answer).trim()}
              onClick={confirm}
            >
              ✓ Sí, guardar
            </button>
            {proposal.readback && (
              <button type="button" className={secondaryButton} onClick={() => speak(edited ?? proposal.readback)}>
                Escuchar
              </button>
            )}
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                discard();
                dictation.start();
              }}
            >
              Volver a dictar
            </button>
            {edited === null && (
              <button type="button" className={secondaryButton} onClick={() => setEdited(proposal.answer)}>
                Corregir con el teclado
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
