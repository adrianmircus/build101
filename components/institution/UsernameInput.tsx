import { describedBy } from "@/components/auth/staff/FieldFrame";
import { field } from "@/components/ui/styles";

type Props = { id: string; studentName: string; value: string; error?: string; onChange: (value: string) => void };

// The username of one row. The visible label is the column header; this one is for whoever listens: it says whose it is.
export function UsernameInput({ id, studentName, value, error, onChange }: Props) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Usuario de {studentName}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { error })}
        className={`${field} min-h-11 px-3 py-2`}
      />
    </>
  );
}
