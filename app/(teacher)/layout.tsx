import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { readDemoSession } from "@/app/demo/session";
import { SignOutButton } from "@/components/auth/staff/SignOutButton";
import { Logo } from "@/components/ui/Logo";
import { MainNav } from "@/components/ui/MainNav";
import { ResetButton } from "@/components/ui/ResetButton";
import { getActor } from "@/lib/server/auth/actor";

const exitLink =
  "inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-slate-900 underline-offset-4 transition-colors hover:bg-slate-100 hover:underline";

// Who is inside and how to leave: a real staff session signs out with the action; the demo keeps its own way out
// (a plain link, so the full reload drops the demo's data). proxy.ts already filters: this is the real check.
async function SessionControls() {
  // The demo first: it needs no database, and proxy.ts drops its cookies when a real session is open, so both never meet.
  const demo = await readDemoSession();
  if (demo === null) {
    const actor = await getActor();
    if (actor?.kind === "student") redirect("/estudiante");
    if (actor?.kind !== "staff") redirect("/ingresar/profesor");
    return <SignOutButton className={exitLink} />;
  }
  if (demo.role !== "teacher") redirect("/estudiante");
  return (
    <>
      <span className="whitespace-nowrap text-slate-700">Prof. demo</span>
      <a href="/demo/salir" className={exitLink}>
        Salir
      </a>
    </>
  );
}

export default function TeacherLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b-2 border-slate-200 bg-white print:hidden" style={{ viewTransitionName: "site-header" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/grupos" className="inline-flex min-h-11 items-center rounded-lg text-xl">
            <Logo />
          </Link>
          <nav aria-label="Principal" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <MainNav />
            <div className="flex items-center gap-3 text-lg sm:border-l-2 sm:border-slate-200 sm:pl-4">
              <Suspense fallback={null}>
                <SessionControls />
              </Suspense>
            </div>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16">
        {children}
      </main>
      <footer className="border-t-2 border-slate-200 print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 text-base text-slate-700">
          <p className="max-w-prose">Los datos de tus estudiantes quedan en tu dispositivo. A la IA nunca le llegan sus nombres.</p>
          <ResetButton />
        </div>
      </footer>
    </div>
  );
}
