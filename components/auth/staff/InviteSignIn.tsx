"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import type { Accepted, InvitationPublic } from "@/lib/domain/accounts/results";
import { primaryButton, textLink } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { InviteNotice } from "./InviteNotice";
import { PASSWORD_FIELD } from "./invitationFailure";
import { PasswordField } from "./PasswordField";
import { TextField } from "./TextField";
import { safely, useInviteSubmit, type InviteHandlers } from "./useInviteSubmit";

type Props = InviteHandlers & {
  invitation: InvitationPublic;
  token: string;
  signInAndAccept: ActionFn<{ token: string; password: string }, Accepted>;
};

// Case «con cuenta, sin sesión» (invitacion-a, #entrar): the email is fixed, only the password is asked.
export function InviteSignIn({ invitation, token, signInAndAccept, ...handlers }: Props) {
  const { notice, pending, show, submit } = useInviteSubmit("signin", handlers);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (password === "") return show({ problems: [{ field: PASSWORD_FIELD, message: "Escribí tu contraseña." }] });
    void submit(safely(signInAndAccept, { token, password }));
  }

  const missing = notice?.problems[0]?.message;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <TextField id="invite-email" name="email" type="email" label="Correo" autoComplete="username" defaultValue={invitation.email} readOnly />
      <PasswordField id={PASSWORD_FIELD} name="password" label="Contraseña" autoComplete="current-password" error={missing} />
      <InviteNotice notice={notice} />
      <div className="flex flex-col items-start gap-3">
        <button type="submit" className={primaryButton} disabled={pending}>
          {pending ? "Entrando…" : "Entrar y sumarme"}
        </button>
        <Link href="/ingresar/profesor/olvide" className={textLink}>
          Olvidé mi contraseña
        </Link>
      </div>
    </form>
  );
}
