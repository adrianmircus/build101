"use client";

import Link from "next/link";
import { useRef } from "react";
import { FocusHeading } from "./FocusHeading";
import { linkClass, quiet } from "./field-styles";
import { useCameraScan } from "./useCameraScan";

type Props = {
  onCode: (raw: string) => void;
  onProblem: () => void;
  onCancel: () => void;
  /** A QR was read that is not a card of Tiza. */
  strangeCode: boolean;
};

/** The camera with a frame to aim at. The video is never recorded or sent: the browser only looks for the QR in it. */
export function CameraPanel({ onCode, onProblem, onCancel, strangeCode }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const ready = useCameraScan(video, { onCode, onProblem });
  return (
    <section aria-labelledby="camara-titulo">
      <FocusHeading id="camara-titulo">Mostrá tu tarjeta</FocusHeading>
      <p className="mt-2 mb-6 text-lg text-slate-700">Poné el cuadrado con puntitos de la tarjeta adentro del marco.</p>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-indigo-950">
        <video ref={video} muted playsInline aria-label="Vista de la cámara" className="size-full object-cover" />
        <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 m-auto w-1/2 text-amber-300" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
          <path d="M4 28V10a6 6 0 0 1 6-6h18M72 4h18a6 6 0 0 1 6 6v18M96 72v18a6 6 0 0 1-6 6H72M28 96H10a6 6 0 0 1-6-6V72" />
        </svg>
      </div>
      <p role="status" className="mt-4 text-lg font-semibold text-slate-900">
        {strangeCode ? "Ese código no es de una tarjeta de Tiza. Probá con el de tu tarjeta." : ready ? "Buscando el código…" : "Abriendo la cámara…"}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <button type="button" onClick={onCancel} className={`${quiet} sm:w-auto`}>
          Cancelar
        </button>
        <Link href="/ingresar/estudiante" className={linkClass}>
          Prefiero escribir mis datos
        </Link>
      </div>
    </section>
  );
}
