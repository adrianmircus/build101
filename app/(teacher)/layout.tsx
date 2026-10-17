import Link from "next/link";
import { ResetButton } from "@/components/ui/ResetButton";
import { logout } from "@/lib/auth/actions";

export default function TeacherLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href="/groups" className="text-xl font-bold text-slate-900">
            Prácticos accesibles
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-6 text-lg">
            <Link href="/groups" className="font-semibold text-indigo-800 underline-offset-4 hover:underline">
              Mis grupos
            </Link>
            <Link href="/subject" className="font-semibold text-indigo-800 underline-offset-4 hover:underline">
              Mi materia
            </Link>
            <span className="text-slate-600">Prof. demo</span>
            <form action={logout}>
              <button type="submit" className="font-semibold text-slate-900 underline-offset-4 hover:underline">
                Salir
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t-2 border-slate-200 print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 text-base text-slate-600">
          <p>Los datos de tus estudiantes quedan en tu dispositivo. A la IA nunca le llegan sus nombres.</p>
          <ResetButton />
        </div>
      </footer>
    </div>
  );
}
