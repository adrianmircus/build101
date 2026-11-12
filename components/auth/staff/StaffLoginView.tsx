import Link from "next/link";
import type { FormEventHandler } from "react";
import { inlineLink, primaryButton, textLink } from "@/components/ui/styles";
import { ErrorSummary, problemFor } from "./ErrorSummary";
import { EMAIL_FIELD, PASSWORD_FIELD, missingTitle, type LoginState } from "./loginState";
import { PasswordField } from "./PasswordField";
import { StatusMessage } from "./StatusMessage";
import { TextField } from "./TextField";

type Props = { state: LoginState; pending: boolean; onSubmit: FormEventHandler<HTMLFormElement> };

export const FORGOT_HREF = "/ingresar/profesor/olvide";

function Notice({ state }: { state: LoginState }) {
  if (state.kind === "fields") {
    return <ErrorSummary key={state.attempt} title={missingTitle(state.problems.length)} problems={state.problems} />;
  }
  if (state.kind === "mismatch") {
    return (
      <StatusMessage key={state.attempt} tone="error">
        <p>
          <strong>El correo o la contraseña no coinciden.</strong> Revisá que estén bien escritos o{" "}
          <Link href={FORGOT_HREF} className={inlineLink}>
            creá una contraseña nueva
          </Link>
          .
        </p>
      </StatusMessage>
    );
  }
  if (state.kind === "failed") {
    return (
      <StatusMessage key={state.attempt} tone="neutral">
        <p>{state.text}</p>
        {state.stale && (
          <button type="button" onClick={() => window.location.reload()} className={textLink}>
            Recargar la página
          </button>
        )}
      </StatusMessage>
    );
  }
  return null;
}

// The form of the login (maquetas login-profe-a and the «faltan» of B). The messages sit above the button, where the eyes are.
export function StaffLoginView({ state, pending, onSubmit }: Props) {
  const problems = state.kind === "fields" ? state.problems : [];
  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
      <TextField
        id={EMAIL_FIELD}
        name="email"
        type="email"
        inputMode="email"
        label="Correo"
        autoComplete="username"
        error={problemFor(problems, EMAIL_FIELD)}
      />
      <PasswordField id={PASSWORD_FIELD} name="password" label="Contraseña" autoComplete="current-password" error={problemFor(problems, PASSWORD_FIELD)} />
      <Notice state={state} />
      <div className="flex flex-col items-stretch gap-3">
        <button type="submit" className={`${primaryButton} w-full`} disabled={pending}>
          {pending ? "Ingresando…" : "Ingresar"}
        </button>
        <Link href={FORGOT_HREF} className={`${textLink} self-start`}>
          Olvidé mi contraseña
        </Link>
      </div>
    </form>
  );
}
