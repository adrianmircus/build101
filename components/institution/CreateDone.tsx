"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { primaryButton, textLink } from "@/components/ui/styles";
import { Icon } from "./Icon";

type Props = { count: number; cardsHref: string; homeHref: string };

// The accounts exist but nobody has a password yet: the next step is the cards. The result is announced and takes the focus.
export function CreateDone({ count, cardsHref, homeHref }: Props) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return (
    <div className="space-y-6">
      <div role="status" className="space-y-3">
        <h1 ref={title} tabIndex={-1} className="text-3xl font-bold outline-none sm:text-4xl">
          {count === 1 ? "Lista la cuenta" : `Listas las ${count} cuentas`}
        </h1>
        <p className="max-w-2xl text-lg text-slate-700">
          Falta un paso: imprimir las tarjetas. Las contraseñas se muestran una sola vez, así que hacelo ahora. En la hoja elegís a quiénes
          imprimir: marcá {count === 1 ? "a la que acabás de crear" : `a las ${count} que acabás de crear`}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href={cardsHref} className={primaryButton}>
          <Icon name="printer" className="size-6" />
          Imprimir tarjetas
        </Link>
        <Link href={homeHref} className={textLink}>
          Lo hago después
        </Link>
      </div>
      <p className="flex max-w-2xl gap-3 rounded-xl bg-slate-100 p-4 text-lg text-slate-900">
        <Icon name="idea" className="mt-0.5 size-6" />
        <span>Si lo hacés después, se crean contraseñas nuevas al imprimir. No pasa nada, nadie entró todavía.</span>
      </p>
    </div>
  );
}
