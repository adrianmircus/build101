import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

type Props = { children: ReactNode; help?: boolean };

// The paper on the board. The backdrop comes from the layout; nothing here says anything about profiles or versions.
export function StudentShell({ children, help = true }: Props) {
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-9">
      <Link href="/" className="focus-on-dark inline-flex min-h-11 items-center self-start rounded-md text-2xl">
        <Logo tone="dark" />
        <span className="sr-only">, ir al inicio</span>
      </Link>
      <div className="rounded-3xl bg-white px-5 py-7 shadow-2xl shadow-black/40 sm:px-9 sm:py-9">{children}</div>
      {help && (
        <div className="space-y-1 text-center text-lg text-indigo-100">
          <p>¿Perdiste tu tarjeta? Tu profe te da una nueva en un minuto.</p>
          <p>
            <Link href="/ingresar/profesor" className="focus-on-dark inline-flex min-h-11 items-center font-semibold text-white underline underline-offset-4">
              Entro como profesor
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}
