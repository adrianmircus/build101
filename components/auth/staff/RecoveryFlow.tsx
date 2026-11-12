"use client";

import { useEffect, useRef, useState } from "react";
import type { NextStep, RecoveryVerified } from "@/lib/domain/accounts/results";
import { textLink } from "@/components/ui/styles";
import type { ActionFn } from "./actionFn";
import { onFragmentChange, takeFragmentToken } from "./fragmentToken";
import { LinkExpired } from "./LinkExpired";
import { recoveryPhaseFor, type RecoveryPhase } from "./recoveryPhase";
import { NewPasswordForm } from "./NewPasswordForm";
import { SheetHeading } from "./SheetHeading";
import { StatusMessage } from "./StatusMessage";

type Props = {
  verifyRecovery: ActionFn<{ tokenHash: string }, RecoveryVerified>;
  setNewPassword: ActionFn<{ password: string; userId: string }, NextStep>;
};

// /ingresar/profesor/nueva#<token_hash>: reads the fragment, clears the bar, asks the server if the link still works
// and shows the form or the «vencido» state. The hash only lives in memory (fragmentToken), also for «Probar de nuevo».
export function RecoveryFlow({ verifyRecovery, setNewPassword }: Props) {
  const [phase, setPhase] = useState<RecoveryPhase>({ kind: "checking" });
  const [round, setRound] = useState(0);
  // The token serves once. Asking twice for the same round (the action gets a new identity when the bar is cleaned and Next
  // renders the page again, and Strict Mode runs effects twice in development) would burn it and show «vencido» to someone with a good link.
  const check = useRef<{ round: number; result: Promise<RecoveryPhase> } | null>(null);
  const [verify] = useState(() => verifyRecovery);

  useEffect(() => {
    let current = true;
    if (check.current?.round !== round) check.current = { round, result: recoveryPhaseFor(verify, takeFragmentToken()) };
    check.current.result.then((next) => {
      if (current) setPhase(next);
    });
    return () => {
      current = false;
    };
  }, [verify, round]);

  function retry() {
    setPhase({ kind: "checking" });
    setRound((n) => n + 1);
  }

  useEffect(() => onFragmentChange(retry), []);

  if (phase.kind === "expired") return <LinkExpired />;
  if (phase.kind === "error") {
    return (
      <div className="space-y-6">
        <SheetHeading title="No pudimos revisar el enlace" />
        <StatusMessage tone="neutral">
          <p>{phase.text}</p>
        </StatusMessage>
        <button type="button" onClick={retry} className={textLink}>
          Probar de nuevo
        </button>
      </div>
    );
  }
  if (phase.kind === "checking") {
    return (
      <p role="status" className="text-lg text-slate-700">
        Un momento, estamos revisando tu enlace…
      </p>
    );
  }
  return (
    <>
      <SheetHeading title="Elegí tu contraseña nueva" lead="Después entrás directo a tus grupos." />
      <NewPasswordForm setNewPassword={setNewPassword} userId={phase.userId} onExpired={() => setPhase({ kind: "expired" })} />
    </>
  );
}
