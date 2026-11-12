"use client";

import { useEffect, useRef } from "react";
import { primary, quiet } from "./styles";

// The confirmation before creating passwords. A native <dialog> opened with showModal(): the page behind becomes
// inert, so the focus stays inside, Tab goes around the dialog, Escape closes it and the focus goes back to the button
// that opened it. It names what is about to happen: new passwords, the old ones stop working, open sessions close.

type Props = { names: readonly string[]; onConfirm: () => void; onCancel: () => void };

const MAX_NAMES = 6;

function title(names: readonly string[]): string {
  if (names.length === 1) return `¿Creamos una tarjeta nueva para ${names[0]}?`;
  return `¿Creamos las contraseñas de estos ${names.length}?`;
}

function listNames(names: readonly string[]): string | null {
  if (names.length === 1) return null;
  if (names.length > MAX_NAMES) return `${names.slice(0, MAX_NAMES).join(", ")} y ${names.length - MAX_NAMES} más.`;
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}.`;
}

export function ConfirmDialog({ names, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const element = dialog.current;
    // The dialog is unmounted by React, which takes it out of the page before close() can give the focus back:
    // we remember who had it and return it ourselves.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element !== null && !element.open && typeof element.showModal === "function") {
      element.showModal();
      heading.current?.focus();
    }
    return () => {
      if (element?.open) element.close();
      if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) opener.focus();
    };
  }, []);

  const plural = names.length !== 1;
  const list = listNames(names);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100%-2rem))] overflow-auto rounded-2xl bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 sm:p-8"
    >
      <h2 id="confirm-title" ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-indigo-950">
        {title(names)}
      </h2>
      <div id="confirm-body" className="mt-4 space-y-3 text-lg">
        {list !== null && <p className="[overflow-wrap:anywhere]">{list}</p>}
        <p>
          Imprimir crea {plural ? "contraseñas nuevas" : "una contraseña nueva"}. {plural ? "Las que tienen ahora dejan de andar" : "La que tiene ahora deja de andar"} y se cierran las sesiones que {plural ? "tengan" : "tenga"} abiertas.
        </p>
        <p>Después se abre la ventana de impresión. Si no imprimís, vas a tener que crear otras: las contraseñas no se guardan.</p>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={primary} onClick={onConfirm}>
          Sí, crear e imprimir
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </dialog>
  );
}
