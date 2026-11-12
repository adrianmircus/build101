import Link from "next/link";
import { secondaryButton, textLink } from "@/components/ui/styles";

// The same answer whether or not there is an account (F2C-10): it says «si hay una cuenta», never «la hay».
// role="status" and the heading take the focus so the screen reader reads it.
export function ForgotSent({ email, onAgain }: { email: string; onAgain: () => void }) {
  return (
    <div className="space-y-6">
      <div role="status" className="space-y-3">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-10 text-indigo-800">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="m4 7 8 6 8-6" />
        </svg>
        <h1 ref={focusOnMount} tabIndex={-1} className="text-3xl font-bold outline-none">
          Revisá tu correo
        </h1>
        <p className="text-lg text-slate-700 [overflow-wrap:break-word]">
          Si hay una cuenta con <strong>{email}</strong>, te mandamos un enlace. En unos minutos te llega; si no lo ves, fijate en el correo no deseado.
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-3">
        <Link href="/ingresar/profesor" className={`${secondaryButton} w-full`}>
          Volver a ingresar
        </Link>
        <button type="button" onClick={onAgain} className={`${textLink} self-start`}>
          No me llegó, mandarlo de nuevo
        </button>
      </div>
    </div>
  );
}

function focusOnMount(node: HTMLHeadingElement | null) {
  node?.focus();
}
