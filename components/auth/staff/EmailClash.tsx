/** The mark of the maqueta B beside the invited email: text and icon, never only color. */
export function EmailClash({ email }: { email: string }) {
  return (
    <span className="mt-1 block">
      <strong>{email}</strong>
      <span className="mt-1 flex items-start gap-2 text-base font-semibold text-amber-900">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 size-5 shrink-0">
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 10v4.5M12 17.5h.01" />
        </svg>
        No es el correo con el que entraste
      </span>
    </span>
  );
}
