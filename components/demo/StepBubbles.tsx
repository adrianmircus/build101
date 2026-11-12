"use client";

import { primaryButton, secondaryButton } from "@/components/ui/styles";
import { Bubble } from "./Bubble";
import { Centered, Docked } from "./Placement";

export function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center rounded-md text-base text-slate-700 underline underline-offset-4 hover:text-slate-950"
      onClick={onSkip}
    >
      Saltear recorrido
    </button>
  );
}

// The last bubble, once the visitor went through every step.
export function FinalBubble({ onSkip }: { onSkip: () => void }) {
  return (
    <Centered>
      <Bubble
        id="final"
        label="Fin del recorrido"
        title="Eso es Tiza.ai"
        body="Un práctico, una versión para cada estudiante, y vos aprobás cada una antes de que llegue."
        actions={
          <div className="grid w-full gap-3">
            <a href="/demo" className={primaryButton}>
              Volver a empezar
            </a>
            <button type="button" className={secondaryButton} onClick={onSkip}>
              Seguir explorando
            </button>
            <a
              href="/demo/salir"
              className="inline-flex min-h-11 items-center justify-center rounded-md text-base text-slate-700 underline underline-offset-4 hover:text-slate-950"
            >
              Salir de la demo
            </a>
          </div>
        }
      />
    </Centered>
  );
}

type Shown = { id: string; label: string; title: string; vw: number; vh: number; onSkip: () => void };

// The visitor left the step's screen: a way back, docked so it doesn't hide anything.
export function AwayBubble({ id, label, step, vw, vh, onSkip, onBack, busy }: Omit<Shown, "title"> & { step: string; onBack: () => void; busy: boolean }) {
  return (
    <Docked vw={vw} vh={vh}>
      <Bubble
        id={`away-${id}`}
        label={label}
        title="Te fuiste del recorrido"
        body={`Estabas en «${step}».`}
        actions={
          <>
            <SkipButton onSkip={onSkip} />
            <button type="button" className={primaryButton} onClick={onBack} disabled={busy}>
              {busy ? "Volviendo…" : "Volver al recorrido"}
            </button>
          </>
        }
      />
    </Docked>
  );
}

// The element isn't on the screen: the bubble shows anyway, docked and with a way forward, so it never gets stuck.
export function MissingBubble({ id, label, title, body, next, vw, vh, onSkip, onNext }: Shown & { body: string; next: string; onNext: () => void }) {
  return (
    <Docked vw={vw} vh={vh}>
      <Bubble
        id={`${id}-docked`}
        label={label}
        title={title}
        body={body}
        actions={
          <>
            <SkipButton onSkip={onSkip} />
            <button type="button" className={primaryButton} onClick={onNext}>
              {next}
            </button>
          </>
        }
      />
    </Docked>
  );
}
