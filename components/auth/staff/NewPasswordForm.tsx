"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { NextStep } from "@/lib/domain/accounts/results";
import { callAction } from "@/lib/client/callAction";
import type { Failure } from "@/lib/errors";
import { primaryButton } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { ErrorSummary, problemFor, type FieldProblem } from "./ErrorSummary";
import { failureKind, failureText } from "./failureText";
import { PASSWORD_HINT, newPasswordProblems, summaryTitle } from "./passwordRules";
import { PasswordField } from "./PasswordField";
import { StatusMessage } from "./StatusMessage";

type Props = { setNewPassword: ActionFn<{ password: string; userId: string }, NextStep>; userId: string; onExpired: () => void };
type Notice = { problems: FieldProblem[]; text: string | null; attempt: number };

const IDS = { password: "new-password", confirm: "new-password-confirm" };

/** What a failed save says: a message of the server for a field it rejected, the text of another account being signed in, or the generic one. */
function noticeFor(result: Failure, attempt: number): Notice {
  // Another account is signed in now: the server changed nothing and says so. The person reads it and opens the link again.
  if (result.code === "CONFLICT") return { problems: [], text: result.message, attempt };
  if (failureKind(result) === "invalid") {
    const message = result.fields?.password ?? "La contraseña no sirve: probá con otra.";
    return { problems: [{ field: IDS.password, message }], text: null, attempt };
  }
  return { problems: [], text: failureText(result), attempt };
}

// «Elegí tu contraseña nueva» (login-profe-a, #nueva). It already has a session from the recovery link.
export function NewPasswordForm({ setNewPassword, userId, onExpired }: Props) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const attempts = useRef(0);
  // Remounting the form empties both passwords and their «mostrar» (the fields are not controlled).
  const [formKey, setFormKey] = useState(0);
  const wipe = () => {
    setPending(false);
    setFormKey((n) => n + 1);
  };
  // Hidden or unmounted (Activity keeps form values): the passwords do not stay behind.
  useEffect(() => wipe, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    attempts.current += 1;
    const attempt = attempts.current;
    const problems = newPasswordProblems(password, String(form.get("confirm") ?? ""), IDS);
    if (problems.length > 0) return setNotice({ problems, text: null, attempt });
    setPending(true);
    const result = await callAction(setNewPassword, { password, userId });
    if (result.ok) {
      wipe();
      return router.replace(result.data.next);
    }
    setPending(false);
    if (result.code === "FORBIDDEN" || result.code === "NOT_FOUND") return onExpired();
    setNotice(noticeFor(result, attempt));
  }

  const problems = notice?.problems ?? [];
  return (
    <form key={formKey} onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
      <PasswordField id={IDS.password} name="password" label="Contraseña nueva" autoComplete="new-password" hint={PASSWORD_HINT} error={problemFor(problems, IDS.password)} />
      <PasswordField id={IDS.confirm} name="confirm" label="Repetí la contraseña" autoComplete="new-password" error={problemFor(problems, IDS.confirm)} />
      {notice && problems.length > 0 && <ErrorSummary key={notice.attempt} title={summaryTitle(problems.length)} problems={problems} />}
      {notice?.text && (
        <StatusMessage key={notice.attempt} tone="neutral">
          <p>{notice.text}</p>
        </StatusMessage>
      )}
      <button type="submit" className={`${primaryButton} w-full`} disabled={pending}>
        {pending ? "Guardando…" : "Guardar y entrar"}
      </button>
    </form>
  );
}
