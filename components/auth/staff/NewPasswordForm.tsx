"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { NextStep } from "@/lib/domain/accounts/results";
import { callAction } from "@/lib/client/callAction";
import { primaryButton } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { ErrorSummary, problemFor, type FieldProblem } from "./ErrorSummary";
import { failureKind, failureText } from "./failureText";
import { PASSWORD_HINT, newPasswordProblems, summaryTitle } from "./passwordRules";
import { PasswordField } from "./PasswordField";
import { StatusMessage } from "./StatusMessage";

type Props = { setNewPassword: ActionFn<{ password: string }, NextStep>; onExpired: () => void };
type Notice = { problems: FieldProblem[]; text: string | null; attempt: number };

const IDS = { password: "new-password", confirm: "new-password-confirm" };

// «Elegí tu contraseña nueva» (login-profe-a, #nueva). It already has a session from the recovery link.
export function NewPasswordForm({ setNewPassword, onExpired }: Props) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const attempts = useRef(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    attempts.current += 1;
    const attempt = attempts.current;
    const problems = newPasswordProblems(password, String(form.get("confirm") ?? ""), IDS);
    if (problems.length > 0) return setNotice({ problems, text: null, attempt });
    setPending(true);
    const result = await callAction(setNewPassword, { password });
    if (result.ok) return router.replace(result.data.next);
    setPending(false);
    if (result.code === "FORBIDDEN" || result.code === "NOT_FOUND") return onExpired();
    if (failureKind(result) === "invalid") {
      const message = result.fields?.password ?? "La contraseña no sirve: probá con otra.";
      return setNotice({ problems: [{ field: IDS.password, message }], text: null, attempt });
    }
    setNotice({ problems: [], text: failureText(result), attempt });
  }

  const problems = notice?.problems ?? [];
  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
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
