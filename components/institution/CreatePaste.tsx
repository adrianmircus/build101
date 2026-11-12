"use client";

import { ErrorSummary, problemFor, type FieldProblem } from "@/components/auth/staff/ErrorSummary";
import { StatusMessage } from "@/components/auth/staff/StatusMessage";
import { FieldFrame, describedBy } from "@/components/auth/staff/FieldFrame";
import { field, primaryButton } from "@/components/ui/styles";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import type { Fields } from "./createFlowState";
import { FlowTop } from "./FlowTop";
import { GroupPicker } from "./GroupPicker";

type Props = {
  institutionHref: string;
  institutionName: string;
  institutionCode: string;
  groups: GroupSummary[];
  subjects: { id: string }[];
  fields: Fields;
  /** What is missing; `attempt` remounts the summary so it is announced again. */
  problems: { list: FieldProblem[]; attempt: number } | null;
  notice: { text: string; attempt: number } | null;
  pending: boolean;
  focus: boolean;
  onField: (name: keyof Fields, value: string) => void;
  onReview: () => void;
};

const NAMES_HINT = "Uno por línea. Podés pegarlos desde una planilla.";

export function CreatePaste({ institutionHref, institutionName, institutionCode, groups, subjects, fields, problems, notice, pending, focus, onField, onReview }: Props) {
  const list = problems?.list ?? [];
  const namesError = problemFor(list, "cr-nombres");
  return (
    <div className="space-y-6">
      <FlowTop
        title="Crear cuentas de estudiantes"
        lead={
          <>
            No necesitan correo. Cada uno entra con el código <strong>{institutionCode}</strong>, su usuario y la contraseña de su tarjeta.
          </>
        }
        back={{ label: institutionName, href: institutionHref }}
        focus={focus}
      />
      {problems && list.length > 0 && <ErrorSummary key={problems.attempt} title={list.length === 1 ? "Falta completar un dato" : `Faltan completar ${list.length} datos`} problems={list} />}
      {notice && (
        <StatusMessage key={notice.attempt} tone="neutral">
          <p>{notice.text}</p>
        </StatusMessage>
      )}
      <form
        noValidate
        className="max-w-2xl space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          onReview();
        }}
      >
        <GroupPicker groups={groups} subjects={subjects} fields={fields} problems={list} onField={onField} />
        <FieldFrame id="cr-nombres" label="Nombres y apellidos" hint={NAMES_HINT} error={namesError}>
          <textarea
            id="cr-nombres"
            rows={8}
            value={fields.names}
            onChange={(event) => onField("names", event.target.value)}
            autoComplete="off"
            aria-invalid={namesError ? true : undefined}
            aria-describedby={describedBy("cr-nombres", { hint: NAMES_HINT, error: namesError })}
            className={field}
          />
        </FieldFrame>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Armando los usuarios…" : "Revisar"}
        </button>
      </form>
    </div>
  );
}
