"use client";

import { useState } from "react";
import { field, secondaryButton } from "@/components/ui/styles";
import { FieldFrame, describedBy } from "./FieldFrame";

type Props = {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  error?: string;
};

// «Mostrar» helps with typing (dysgraphia, motor): the field is a normal one, so the password manager and pasting work.
export function PasswordField({ id, name, label, autoComplete, hint, error }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { hint, error })}
          className={`${field} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-controls={id}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          className={`${secondaryButton} shrink-0 px-3 text-base`}
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
    </FieldFrame>
  );
}
