import type { ChangeEventHandler, ReactNode, Ref } from "react";
import { inputClass, labelClass } from "./field-styles";

type Props = {
  value: string;
  reveal: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onToggle: () => void;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  children?: ReactNode;
};

export const PASSWORD_ID = "contrasena";

/** The password can be pasted and shown: the button says what it will do, and the field keeps its text either way. */
export function PasswordField({ value, reveal, onChange, onToggle, describedBy, inputRef, children }: Props) {
  return (
    <div className="grid gap-2">
      <label htmlFor={PASSWORD_ID} className={labelClass}>
        Contraseña
      </label>
      <div className="relative">
        <input
          id={PASSWORD_ID}
          name="password"
          ref={inputRef}
          type={reveal ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={describedBy}
          className={`${inputClass} pr-28`}
          required
        />
        <button
          type="button"
          onClick={onToggle}
          aria-controls={PASSWORD_ID}
          className="absolute top-1/2 right-1.5 min-h-11 min-w-11 -translate-y-1/2 rounded-lg px-3 text-base font-semibold text-indigo-800 hover:bg-slate-100"
        >
          {reveal ? "Ocultar" : "Mostrar"}
          <span className="sr-only"> contraseña</span>
        </button>
      </div>
      {children}
    </div>
  );
}
