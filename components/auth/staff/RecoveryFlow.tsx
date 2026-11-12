"use client";

import { useEffect, useState } from "react";
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
  setNewPassword: ActionFn<{ password: string }, NextStep>;
};

// /ingresar/profesor/nueva#<token_hash>: reads the fragment, clears the bar, asks the server if the link still works
// and shows the form or the «vencido» state. The hash only lives in memory (fragmentToken), also for «Probar de nuevo».
export function RecoveryFlow({ verifyRecovery, setNewPassword }: Props) {
  const [phase, setPhase] = useState<RecoveryPhase>({ kind: "checking" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    recoveryPhaseFor(verifyRecovery, takeFragmentToken()).then((next) => {
      if (current) setPhase(next);
    });
    return () => {
      current = false;
    };
  }, [verifyRecovery, round]);

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
      <NewPasswordForm setNewPassword={setNewPassword} onExpired={() => setPhase({ kind: "expired" })} />
    </>
  );
}
