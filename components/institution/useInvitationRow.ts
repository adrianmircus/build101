"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import type { ActionFn } from "@/components/auth/staff/actionFn";
import { failureText } from "@/components/auth/staff/failureText";
import { callAction } from "@/lib/client/callAction";
import type { InvitationView } from "@/lib/domain/accounts/entities";
import type { ResendInvitationInput, RevokeInvitationInput } from "@/lib/domain/accounts/inputs";
import type { InvitationResent } from "@/lib/domain/accounts/results";

export type InvitationActions = {
  resend: ActionFn<z.input<typeof ResendInvitationInput>, InvitationResent>;
  revoke: ActionFn<z.input<typeof RevokeInvitationInput>, { id: string }>;
};

/** The id of the title of the list of invitations: where the focus goes when a row leaves. */
export const WAITING_TITLE = "esperando-titulo";

export type RowPhase = "idle" | "confirming" | "busy";
export type RowMessage = { kind: "ok" | "problem"; text: string; attempt: number };

// What «Reenviar» and «Revocar» do for one invitation. After each one the list is read again (router.refresh), so the
// row shows the state the server has. If somebody else changed the invitation first (revision), it says so.
export function useInvitationRow(institutionId: string, item: InvitationView, actions: InvitationActions) {
  const router = useRouter();
  const [phase, setPhase] = useState<RowPhase>("idle");
  const [message, setMessage] = useState<RowMessage | null>(null);
  const [count, setCount] = useState(0);
  const say = (kind: RowMessage["kind"], text: string) => {
    setCount((value) => value + 1);
    setMessage({ kind, text, attempt: count + 1 });
  };
  const input = { institutionId, invitationId: item.id, revision: item.revision };

  async function resend() {
    setPhase("busy");
    const result = await callAction(actions.resend, input);
    setPhase("idle");
    if (result.ok) {
      say(result.data.mailSent ? "ok" : "problem", result.data.mailSent ? "Reenviada. El enlace dura 7 días más." : "Quedó renovada, pero no pudimos mandar el correo. Probá de nuevo en un rato.");
      return router.refresh();
    }
    if (result.code === "CONFLICT") {
      say("problem", "Esta invitación cambió mientras mirabas. Actualizamos la lista.");
      return router.refresh();
    }
    say("problem", failureText(result));
  }

  async function revoke() {
    setPhase("busy");
    const result = await callAction(actions.revoke, input);
    if (result.ok) {
      // The row is about to disappear with the focus on it: the focus goes to the title of the list.
      document.getElementById(WAITING_TITLE)?.focus();
      return router.refresh();
    }
    setPhase("idle");
    if (result.code === "CONFLICT") router.refresh();
    say("problem", result.code === "CONFLICT" ? "Esta invitación cambió mientras mirabas. Actualizamos la lista." : failureText(result));
  }

  return { phase, message, ask: () => setPhase("confirming"), cancel: () => setPhase("idle"), resend, revoke };
}
