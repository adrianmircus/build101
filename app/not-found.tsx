import Link from "next/link";
import { MathBackdrop } from "@/components/auth/MathBackdrop";
import { Logo } from "@/components/ui/Logo";

// Any unknown URL: the board, a plain sentence and the way back home.
export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-indigo-950">
      <MathBackdrop variant="still" />
      <header className="mx-auto w-full max-w-6xl px-4 pt-6">
        <Link href="/" className="focus-on-dark inline-flex min-h-11 items-center rounded-md text-xl">
          <Logo tone="dark" />
        </Link>
      </header>
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 pb-24">
        <h1 className="max-w-[680px] text-4xl leading-tight font-semibold text-white sm:text-6xl">
          Esta página no existe
        </h1>
        <p className="mt-6 max-w-[680px] text-lg text-indigo-100 sm:text-xl">
          Puede que el link esté mal escrito o que la página se haya movido.
        </p>
        <div className="mt-10">
          <Link
            href="/"
            className="focus-on-dark inline-flex min-h-11 items-center rounded-xl bg-amber-300 px-6 py-3 text-lg font-semibold text-indigo-950 transition-colors duration-300 ease-soft hover:bg-amber-200 active:translate-y-px"
          >
            Volver al inicio
          </Link>
        </div>
      </main>
    </div>
  );
}
