"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/salir/actions";
import { callAction } from "@/lib/client/callAction";
import type { NextStep } from "@/lib/domain/accounts/results";
import { secondaryButton } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { StatusMessage } from "./StatusMessage";

type Props = {
  /** The visible text. Default: «Salir». */
  label?: string;
  /** Classes of the button; the secondary button of the app by default. */
  className?: string;
  /** What to do once signed out. By default it goes where the server says (the login of that type of session). */
  onSignedOut?: (next: string) => void;
  /** Only for tests and for screens that already hold the action. */
  signOut?: ActionFn<Record<string, never>, NextStep>;
};

// Reusable «Salir»: it is mounted by the header of the teacher and the student (T2.8), and by the invitation screen
// (to enter with another email). If it fails, it says so and the session stays as it was.
export function SignOutButton({ label = "Salir", className = secondaryButton, onSignedOut, signOut = signOutAction }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(0);

  async function onClick() {
    setPending(true);
    const result = await callAction(signOut, {});
    if (!result.ok) {
      setPending(false);
      return setFailed((count) => count + 1);
    }
    if (onSignedOut) onSignedOut(result.data.next);
    else router.replace(result.data.next);
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} className={className}>
        {pending ? "Saliendo…" : label}
      </button>
      {failed > 0 && (
        <StatusMessage key={failed} tone="neutral">
          <p>No pudimos cerrar tu sesión ahora. Probá de nuevo en un rato.</p>
        </StatusMessage>
      )}
    </>
  );
}
