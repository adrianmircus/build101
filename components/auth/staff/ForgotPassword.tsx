"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { ResetRequested } from "@/lib/domain/accounts/results";
import { callAction } from "@/lib/client/callAction";
import { primaryButton, textLink } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { failureKind, failureText } from "./failureText";
import { ForgotSent } from "./ForgotSent";
import { formatRetryTime } from "./retryTime";
import { SheetHeading } from "./SheetHeading";
import { StatusMessage } from "./StatusMessage";
import { TextField } from "./TextField";

type Props = { requestReset: ActionFn<{ email: string }, ResetRequested> };
type Problem = { kind: "field" | "failed"; text: string; attempt: number };

const EMAIL_ID = "forgot-email";
const MISSING = "Escribí tu correo, por ejemplo nombre@colegio.edu.uy.";

function failureProblem(failure: Parameters<typeof failureText>[0], attempt: number): Problem {
  if (failureKind(failure) === "invalid") return { kind: "field", text: "Revisá el correo: tiene que ser como nombre@colegio.edu.uy.", attempt };
  if (failureKind(failure) === "blocked") {
    const when = formatRetryTime(failure.retryAt);
    return { kind: "failed", text: `Pediste varios enlaces seguidos. Probá de nuevo ${when ?? "en unos minutos"}.`, attempt };
  }
  return { kind: "failed", text: failureText(failure), attempt };
}

// «Creá una contraseña nueva» (login-profe-a, #olvide). Whatever the email, the answer is the same: it never says if it exists.
export function ForgotPassword({ requestReset }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const attempts = useRef(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setEmail(typed);
    attempts.current += 1;
    if (typed === "") return setProblem({ kind: "field", text: MISSING, attempt: attempts.current });
    setPending(true);
    const result = await callAction(requestReset, { email: typed });
    setPending(false);
    if (result.ok) return setSent(true);
    setProblem(failureProblem(result, attempts.current));
  }

  if (sent) return <ForgotSent email={email} onAgain={() => setSent(false)} />;
  const fieldError = problem?.kind === "field" ? problem.text : undefined;
  return (
    <>
      <SheetHeading title="Creá una contraseña nueva" lead="Te mandamos un enlace a tu correo. Dura una hora y sirve una sola vez." />
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
        <TextField id={EMAIL_ID} name="email" type="email" inputMode="email" label="Correo" autoComplete="username" defaultValue={email} error={fieldError} />
        {problem && (
          <StatusMessage key={problem.attempt} tone={problem.kind === "field" ? "error" : "neutral"}>
            <p>{problem.kind === "field" ? <a href={`#${EMAIL_ID}`} className="font-semibold underline underline-offset-4">{problem.text}</a> : problem.text}</p>
          </StatusMessage>
        )}
        <div className="flex flex-col items-stretch gap-3">
          <button type="submit" className={`${primaryButton} w-full`} disabled={pending}>
            {pending ? "Mandando…" : "Mandarme el enlace"}
          </button>
          <Link href="/ingresar/profesor" className={`${textLink} self-start`}>
            Volver a ingresar
          </Link>
        </div>
      </form>
    </>
  );
}
