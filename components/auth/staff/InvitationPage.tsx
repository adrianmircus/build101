import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

// The page of an invitation (docs/diseno/fase-2/invitacion-a.html): light, a letter on top and the one action below.
// It does not load anything from third parties: the token is in the page.

export function InvitationPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="mx-auto max-w-2xl px-4 pt-6">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-md text-2xl">
          <Logo />
          <span className="sr-only">, ir al inicio</span>
        </Link>
      </header>
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
