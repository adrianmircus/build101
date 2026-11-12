"use client";

import Link from "next/link";
import type { Accepted, InvitationPublic } from "@/lib/domain/accounts/results";
import { primaryButton, textLink } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { InviteNotice } from "./InviteNotice";
import { safely, useInviteSubmit, type InviteHandlers } from "./useInviteSubmit";

type Props = InviteHandlers & {
  invitation: InvitationPublic;
  token: string;
  accept: ActionFn<{ token: string }, Accepted>;
};

// Case «con sesión y el mismo correo» (invitacion-a, #aceptar): one tap. The page never accepts by itself:
// joining an institution is an action with effect, so the person confirms it.
export function InviteAccept({ invitation, token, accept, ...handlers }: Props) {
  const { notice, pending, submit } = useInviteSubmit("accept", handlers);
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-slate-100 p-4 text-lg font-semibold [overflow-wrap:break-word]">Entraste como {invitation.email}</p>
      <InviteNotice notice={notice} />
      <div className="flex flex-col items-start gap-3">
        <button type="button" className={primaryButton} disabled={pending} onClick={() => void submit(safely(accept, { token }))}>
          {pending ? "Sumándote…" : `Sumarme a ${invitation.institutionName}`}
        </button>
        <Link href="/grupos" className={textLink}>
          Ahora no
        </Link>
      </div>
    </div>
  );
}
