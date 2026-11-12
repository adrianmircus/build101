import { field } from "@/components/ui/styles";
import { FieldFrame, describedBy } from "./FieldFrame";

type Props = {
  id: string;
  name: string;
  label: string;
  type?: "text" | "email";
  autoComplete: string;
  inputMode?: "email" | "text";
  defaultValue?: string;
  readOnly?: boolean;
  hint?: string;
  error?: string;
};

// Uncontrolled on purpose: what the person typed stays when a message appears, and pasting always works.
export function TextField({ id, name, label, type = "text", autoComplete, inputMode, defaultValue, readOnly, hint, error }: Props) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={defaultValue}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={readOnly ? `${field} bg-slate-100` : field}
      />
    </FieldFrame>
  );
}
