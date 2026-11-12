import type { ChangeEventHandler } from "react";
import { CheckIcon } from "./CheckIcon";
import { NeutralMessage } from "./NeutralMessage";
import { StudentField } from "./StudentField";
import type { Lookup } from "./useSchoolLookup";

type Props = {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onBlur: () => void;
  lookup: Lookup;
  /** The «falta el código» message of a submit, shown next to the field. */
  missing?: boolean;
};

export const CODE_ID = "colegio";

/** The school code: when it is complete, the name of the school shows up under it; a code that doesn't exist is said by name. */
export function SchoolCodeField({ value, onChange, onBlur, lookup, missing }: Props) {
  const notFound = lookup.kind === "missing";
  const describedBy = notFound ? "colegio-aviso" : missing ? "colegio-falta" : "colegio-nombre";
  return (
    <StudentField id={CODE_ID} label="Código del colegio" value={value} autoComplete="organization" onChange={onChange} onBlur={onBlur} describedBy={describedBy} invalid={notFound || missing}>
      <p id="colegio-nombre" role="status" className="flex items-center gap-2 text-lg font-semibold text-slate-900 empty:hidden">
        {lookup.kind === "found" && (
          <>
            <CheckIcon className="size-5 shrink-0 text-emerald-800" />
            {lookup.name}
          </>
        )}
      </p>
      {notFound && (
        <NeutralMessage id="colegio-aviso" takeFocus={false}>
          <p>
            No encontramos el colegio <strong>{value.trim()}</strong>. Revisá que esté igual que en la tarjeta.
          </p>
        </NeutralMessage>
      )}
      {missing && (
        <NeutralMessage id="colegio-falta">
          <p>Falta el código del colegio. Está en la tarjeta.</p>
        </NeutralMessage>
      )}
    </StudentField>
  );
}
