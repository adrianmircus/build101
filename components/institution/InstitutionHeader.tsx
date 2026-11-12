"use client";

import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { SignOutButton } from "@/components/auth/staff/SignOutButton";
import { textLink } from "@/components/ui/styles";

// The header of the admin area: the logo, the way to the groups and to the institution, and «Salir». Without a line
// underneath: the white against the grey of the page is enough.
export function InstitutionHeader() {
  return (
    <header className="bg-white print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2">
        <Link href="/grupos" className="inline-flex min-h-11 items-center rounded-lg text-xl">
          <Logo />
          <span className="sr-only">, ir a mis grupos</span>
        </Link>
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-x-2">
          <Link href="/grupos" className={`${textLink} px-3 font-semibold no-underline hover:underline`}>
            Mis grupos
          </Link>
          <Link href="/institucion" aria-current="page" className="inline-flex min-h-11 items-center px-3 text-lg font-semibold text-indigo-950 underline decoration-indigo-700 decoration-[3px] underline-offset-8">
            Institución
          </Link>
          <SignOutButton label="Salir" className={`${textLink} px-3 font-semibold no-underline hover:underline`} />
        </nav>
      </div>
    </header>
  );
}
