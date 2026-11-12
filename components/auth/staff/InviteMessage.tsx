"use client";

import Link from "next/link";
import { secondaryButton } from "@/components/ui/styles";
import { InvitationLetter } from "./InvitationLetter";
import { StatusMessage } from "./StatusMessage";

type Props =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; text: string; onRetry: () => void };

// The three screens with no invitation to show: reading it, a link with no token, and a failure that can be tried again.
export function InviteMessage(props: Props) {
  if (props.kind === "loading") {
    return (
      <p role="status" className="text-lg text-slate-700">
        Un momento, estamos abriendo tu invitación…
      </p>
    );
  }
  if (props.kind === "missing") {
    return (
      <>
        <InvitationLetter title="Falta algo en este enlace">
          <p>Abrí la invitación desde el correo que te mandamos: tocá el botón o copiá el enlace completo, hasta el final.</p>
        </InvitationLetter>
        <div className="mt-8">
          <Link href="/ingresar/profesor" className={secondaryButton}>
            Ir a ingresar
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <InvitationLetter title="No pudimos abrir la invitación" />
      <div className="mt-8 space-y-6">
        <StatusMessage tone="neutral">
          <p>{props.text}</p>
        </StatusMessage>
        <button type="button" onClick={props.onRetry} className={secondaryButton}>
          Probar de nuevo
        </button>
      </div>
    </>
  );
}
