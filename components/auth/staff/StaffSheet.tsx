import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { inlineLink } from "@/components/ui/styles";

// The sheet over the board of /ingresar (the backdrop comes from app/ingresar/layout.tsx): login, recover, new password.

export function StaffSheet({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="focus-on-dark inline-flex min-h-11 items-center self-start rounded-md text-2xl">
        <Logo tone="dark" />
      </Link>
      <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/40 sm:p-8">{children}</div>
      <p className="text-lg text-indigo-100">
        ¿Sos estudiante?{" "}
        <Link href="/ingresar/estudiante" className={`${inlineLink} focus-on-dark text-white hover:text-amber-200`}>
          Entrá con tu tarjeta
        </Link>
      </p>
    </main>
  );
}
