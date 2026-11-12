"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { primaryButton, textLink } from "@/components/ui/styles";
import type { InviteRowResult } from "@/lib/domain/accounts/results";
import { Icon } from "./Icon";
import { doneTitle, hasTrouble, outcomeText } from "./inviteOutcome";

type Props = { results: InviteRowResult[]; homeHref: string; listHref: string; onAgain: () => void };

// The result is announced (role="status") and takes the focus. If something did not go out, each email says why.
export function InviteDone({ results, homeHref, listHref, onAgain }: Props) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  const trouble = hasTrouble(results);
  return (
    <div className="space-y-6">
      <div role="status" className="space-y-3">
        <h1 ref={title} tabIndex={-1} className="text-3xl font-bold outline-none sm:text-4xl">
          {doneTitle(results)}
        </h1>
        <p className="max-w-2xl text-lg text-slate-700">
          {trouble ? "Estos correos tuvieron algo para mirar. Los demás ya están en camino." : "Les llega un correo con un enlace que dura 7 días. Los ves en «Esperando respuesta»."}
        </p>
      </div>
      {trouble && (
        <ul className="max-w-2xl space-y-2">
          {results
            .filter((row) => row.outcome !== "sent")
            .map((row) => (
              <li key={row.email} className="flex gap-3 rounded-xl bg-slate-100 p-4 text-lg text-slate-900">
                <Icon name="idea" className="mt-0.5 size-6" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <strong className="font-semibold">{row.email}</strong>
                  <br />
                  {outcomeText(row.outcome)}
                </span>
              </li>
            ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href={listHref} className={primaryButton}>
          Ver profes e invitaciones
        </Link>
        <button type="button" onClick={onAgain} className={textLink}>
          Invitar a más profes
        </button>
        <Link href={homeHref} className={textLink}>
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
