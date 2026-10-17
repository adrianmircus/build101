"use client";

import { useActionState } from "react";
import { field, primaryButton } from "@/components/ui/styles";
import type { LoginState } from "@/lib/auth/actions";

type Props = {
  action: (previous: LoginState, formData: FormData) => Promise<LoginState>;
};

export function LoginForm({ action }: Props) {
  const [state, submit, submitting] = useActionState(action, {});
  return (
    <form action={submit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="username" className="block text-lg font-semibold">
          Usuario
        </label>
        <input
          id="username"
          name="username"
          className={field}
          autoComplete="username"
          autoCapitalize="none"
          defaultValue={state.username}
          aria-describedby={state.error ? "login-error" : undefined}
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-lg font-semibold">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className={field}
          autoComplete="current-password"
          aria-describedby={state.error ? "login-error" : undefined}
          required
        />
      </div>
      {state.error && (
        <p id="login-error" role="alert" className="rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-lg text-red-900">
          {state.error}
        </p>
      )}
      <button type="submit" className={`${primaryButton} w-full`} disabled={submitting}>
        {submitting ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
