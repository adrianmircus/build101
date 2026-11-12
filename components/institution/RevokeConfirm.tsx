"use client";

import { useEffect, useRef } from "react";
import { dangerButton, textLink } from "@/components/ui/styles";

type Props = { email: string; onRevoke: () => void; onCancel: () => void };

// Revoking cannot be undone from here, so it asks first. The focus lands on the safe answer, «No, dejarla».
export function RevokeConfirm({ email, onRevoke, onCancel }: Props) {
  const safe = useRef<HTMLButtonElement>(null);
  useEffect(() => safe.current?.focus(), []);
  return (
    <div role="group" aria-label={`Revocar la invitación de ${email}`} className="space-y-2 rounded-xl bg-slate-100 p-4">
      <p className="text-lg">¿Revocás la invitación? El enlace que ya mandamos deja de servir.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={onRevoke} className={dangerButton}>
          Sí, revocar
        </button>
        <button ref={safe} type="button" onClick={onCancel} className={textLink}>
          No, dejarla
        </button>
      </div>
    </div>
  );
}
