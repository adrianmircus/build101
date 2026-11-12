"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { NextStep } from "@/lib/domain/accounts/results";
import { callAction } from "@/lib/client/callAction";
import type { ActionFn } from "./actionFn";
import { LoginBlocked } from "./LoginBlocked";
import { missingFields, stateFromResult, type LoginState } from "./loginState";
import { SheetHeading } from "./SheetHeading";
import { StaffLoginView } from "./StaffLoginView";

type Props = { signIn: ActionFn<{ email: string; password: string }, NextStep> };

// Login of the teacher (docs/diseno/fase-2/login-profe-a.html, with the «faltan» and «bloqueado» of B).
// The services answer UNAVAILABLE until phase 2 closes: the screen then says so with a neutral message.
export function StaffLoginForm({ signIn }: Props) {
  const router = useRouter();
  const [state, setState] = useState<LoginState>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  const attempts = useRef(0);
  // Remounting the form empties the fields (they are not controlled) and the «mostrar» of the password.
  const [formKey, setFormKey] = useState(0);
  const wipe = () => {
    setPending(false);
    setFormKey((n) => n + 1);
  };
  // Hidden or unmounted (Activity keeps form values): the password does not stay behind.
  useEffect(() => wipe, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    attempts.current += 1;
    const problems = missingFields(email, password);
    if (problems.length > 0) return setState({ kind: "fields", problems, attempt: attempts.current });
    setPending(true);
    const next = stateFromResult(await callAction(signIn, { email, password }), attempts.current);
    if (next.kind === "go") {
      wipe();
      return router.replace(next.next);
    }
    setPending(false);
    setState(next);
  }

  if (state.kind === "blocked") {
    return (
      <>
        <SheetHeading title="Esperá unos minutos" />
        <LoginBlocked when={state.when} />
      </>
    );
  }
  return (
    <>
      <SheetHeading title="Ingresá a Tiza.ai" lead="Con el correo y la contraseña de tu cuenta de profe." />
      <StaffLoginView key={formKey} state={state} pending={pending} onSubmit={onSubmit} />
    </>
  );
}
