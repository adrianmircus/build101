import type { ChangeEventHandler, FocusEventHandler, ReactNode, Ref } from "react";
import { inputClass, labelClass } from "./field-styles";

type Props = {
  id: string;
  label: string;
  value: string;
  autoComplete: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  describedBy?: string;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** What goes under the input: the name of the school, a message. */
  children?: ReactNode;
};

/** A text field of the card. Everything can be pasted; the browser's own helpers (autocomplete) work. */
export function StudentField({ id, label, value, autoComplete, onChange, onBlur, describedBy, invalid, inputRef, children }: Props) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        ref={inputRef}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className={inputClass}
        required
      />
      {children}
    </div>
  );
}
