"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import type { Accepted, InvitationPublic } from "@/lib/domain/accounts/results";
import { inlineLink, primaryButton } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { problemFor, type FieldProblem } from "./ErrorSummary";
import { InviteNotice } from "./InviteNotice";
import { NAME_FIELD, PASSWORD_FIELD } from "./invitationFailure";
import { PASSWORD_HINT, passwordMessage } from "./passwordRules";
import { PasswordField } from "./PasswordField";
import { TextField } from "./TextField";
import { safely, useInviteSubmit, type InviteHandlers } from "./useInviteSubmit";

type Props = InviteHandlers & {
  invitation: InvitationPublic;
  token: string;
  acceptAsNew: ActionFn<{ token: string; displayName: string; password: string }, Accepted>;
  onSignIn: () => void;
};

function localProblems(name: string, password: string): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (name === "") problems.push({ field: NAME_FIELD, message: "Escribí tu nombre y apellido." });
  const message = passwordMessage(password);
  if (message) problems.push({ field: PASSWORD_FIELD, message });
  return problems;
}

// Case «sin cuenta» (invitacion-a, #nueva-cuenta): name and password; the email is the one of the invitation.
export function InviteNewAccount({ invitation, token, acceptAsNew, onSignIn, ...handlers }: Props) {
  const { notice, pending, show, submit, formKey } = useInviteSubmit("new", handlers);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("name") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const problems = localProblems(displayName, password);
    if (problems.length > 0) return show({ problems });
    void submit(safely(acceptAsNew, { token, displayName, password }));
  }

  const problems = notice?.problems ?? [];
  return (
    <form key={formKey} onSubmit={onSubmit} noValidate className="space-y-6">
      <TextField id="invite-email" name="email" type="email" label="Correo" autoComplete="username" defaultValue={invitation.email} readOnly hint="Es el correo de la invitación, no se puede cambiar." />
      <TextField id={NAME_FIELD} name="name" label="Nombre y apellido" autoComplete="name" hint="Lo ven los demás profes del colegio. Tus estudiantes no." error={problemFor(problems, NAME_FIELD)} />
      <PasswordField id={PASSWORD_FIELD} name="password" label="Contraseña" autoComplete="new-password" hint={PASSWORD_HINT} error={problemFor(problems, PASSWORD_FIELD)} />
      <InviteNotice notice={notice} />
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Creando tu cuenta…" : "Crear cuenta y sumarme"}
      </button>
      <p className="text-base text-slate-700">
        Al crear la cuenta aceptás los{" "}
        <Link href="/terminos" className={inlineLink}>
          términos
        </Link>{" "}
        y la{" "}
        <Link href="/privacidad" className={inlineLink}>
          política de privacidad
        </Link>
        .
      </p>
      <p className="text-base text-slate-700">
        ¿Ya tenés cuenta en Tiza.ai con este correo?{" "}
        <button type="button" onClick={onSignIn} className={`${inlineLink} min-h-11`}>
          Entrá para aceptar
        </button>
        .
      </p>
    </form>
  );
}
