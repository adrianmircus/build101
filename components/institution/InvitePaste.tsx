"use client";

import { ErrorSummary } from "@/components/auth/staff/ErrorSummary";
import { FieldFrame, describedBy } from "@/components/auth/staff/FieldFrame";
import { field, primaryButton } from "@/components/ui/styles";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import { FlowTop } from "./FlowTop";
import { RoleField } from "./RoleField";

type Props = {
  institutionHref: string;
  institutionName: string;
  text: string;
  role: InvitedRole;
  /** The message about the pasted text, when it cannot be reviewed yet. `attempt` remounts it so it is announced again. */
  problem: { message: string; attempt: number } | null;
  focus: boolean;
  onText: (value: string) => void;
  onRole: (role: InvitedRole) => void;
  onReview: () => void;
};

const HINT = "Uno por línea, o separados por coma. Podés pegarlos desde una planilla.";

export function InvitePaste({ institutionHref, institutionName, text, role, problem, focus, onText, onRole, onReview }: Props) {
  const error = problem?.message;
  return (
    <div className="space-y-6">
      <FlowTop
        title="Invitar profes"
        lead="Pegá los correos. En el paso siguiente los revisás antes de mandar: no se manda nada hasta que confirmes."
        back={{ label: institutionName, href: institutionHref }}
        focus={focus}
      />
      {problem && <ErrorSummary key={problem.attempt} title="Falta completar un dato" problems={[{ field: "iv-correos", message: problem.message }]} />}
      <form
        noValidate
        className="max-w-2xl space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          onReview();
        }}
      >
        <FieldFrame id="iv-correos" label="Correos" hint={HINT} error={error}>
          <textarea
            id="iv-correos"
            name="correos"
            rows={7}
            value={text}
            onChange={(event) => onText(event.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy("iv-correos", { hint: HINT, error })}
            className={field}
          />
        </FieldFrame>
        <RoleField value={role} onChange={onRole} />
        <button type="submit" className={primaryButton}>
          Revisar
        </button>
      </form>
    </div>
  );
}
