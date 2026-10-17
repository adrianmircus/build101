import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/ui/styles";

// Minimal landing. The final version (copy, product name) is defined by Product.
export default function Home() {
  return (
    <main id="main-content" className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-lg font-semibold text-indigo-800">Matemática · 6.º de bachillerato</p>
      <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
        Un práctico, una versión para cada estudiante del grupo.
      </h1>
      <p className="text-xl text-slate-700">
        Cargás el práctico una vez y la IA arma una versión adaptada para quienes tienen TDAH, dislexia o TEA. Vos
        revisás y aprobás cada versión antes de imprimirla.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/login/teacher" className={primaryButton}>
          Soy profesor
        </Link>
        <Link href="/login/student" className={secondaryButton}>
          Soy estudiante
        </Link>
      </div>
    </main>
  );
}
