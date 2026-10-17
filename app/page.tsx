import Link from "next/link";
import { MathBackdrop } from "@/components/auth/MathBackdrop";
import { Logo } from "@/components/ui/Logo";
import { PageTransition } from "@/components/ui/transitions";
import { seed } from "@/lib/groups/seed";
import { groupByProfiles, versionLabel } from "@/lib/groups/versions";

// The sample group, run through the same grouping the app uses, so the landing never drifts from the product.
const SAMPLE_GROUP = seed().groups[0];
const SAMPLE_VERSIONS = groupByProfiles(SAMPLE_GROUP.students);

// Public landing. Written on the same board as the login, so landing → login reads as one piece.
export default function Home() {
  return (
    <PageTransition>
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-indigo-950">
        <MathBackdrop variant="dim" />
        <header className="mx-auto w-full max-w-6xl px-4 pt-6">
          <Link href="/" className="focus-on-dark inline-flex min-h-11 items-center rounded-md text-2xl">
            <Logo tone="dark" />
          </Link>
        </header>
        <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 pt-12 pb-24">
          <h1 className="max-w-[16ch] text-[clamp(1.9rem,8.5vw,6.25rem)] leading-[0.98] font-bold tracking-tight text-white">
            Una versión para cada estudiante.
          </h1>
          <p className="mt-8 max-w-xl text-lg text-indigo-50 sm:text-2xl">
            Cargás tu práctico una vez y Tiza.ai arma una versión para quienes tienen TDAH, dislexia o TEA. Vos aprobás
            cada una.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/ingresar/profesor"
              className="focus-on-dark inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-300 px-7 py-4 text-xl font-bold text-indigo-950 transition-colors hover:bg-amber-200 active:translate-y-px"
            >
              Soy profesor
            </Link>
            <Link
              href="/ingresar/estudiante"
              className="focus-on-dark inline-flex min-h-11 items-center rounded-md text-xl font-semibold text-white underline underline-offset-4 hover:text-amber-200"
            >
              Soy estudiante
            </Link>
          </div>
        </main>
      </div>

      <section aria-labelledby="how-heading" className="bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 lg:grid-cols-[5fr_6fr] lg:items-center lg:py-36">
          <div className="space-y-6 text-lg text-slate-900 sm:text-xl">
            <h2 id="how-heading" className="text-4xl font-bold tracking-tight sm:text-5xl">
              Tu grupo, en {SAMPLE_VERSIONS.length} versiones
            </h2>
            <p>
              Marcás qué estudiantes tienen TDAH, dislexia o TEA. Tiza.ai arma una versión por cada combinación que hay
              en el grupo, no una por alumno.
            </p>
            <p>Los números y lo que se evalúa no cambian: cambia cómo se presenta. Ves cada cambio con su porqué.</p>
            <p>Nada se imprime sin tu aprobación, y a la IA nunca le llegan los nombres de tus estudiantes.</p>
          </div>

          {/* A fragment of the real interface: the version picker of an assessment for the sample group. */}
          <figure data-ui className="rounded-2xl bg-white p-5 sm:p-8">
            <figcaption className="mb-5 text-lg text-slate-700">
              <span className="font-bold text-slate-900">{SAMPLE_GROUP.name}</span> · {SAMPLE_GROUP.students.length}{" "}
              estudiantes · Práctico: Límites de funciones
            </figcaption>
            <ul className="grid gap-3 sm:grid-cols-2">
              {SAMPLE_VERSIONS.map((v, i) => (
                <li
                  key={v.profiles.join("+") || "base"}
                  className={`rounded-xl border-2 px-4 py-3 ${i === 1 ? "border-indigo-700 bg-indigo-50" : "border-slate-300"}`}
                >
                  <p className="text-lg font-bold text-slate-900">{versionLabel(v.profiles)}</p>
                  <p className="text-base text-slate-700">
                    {v.studentIds.length} {v.studentIds.length === 1 ? "estudiante" : "estudiantes"} ·{" "}
                    {i < 2 ? <span className="font-semibold text-emerald-800">Aprobada</span> : "Para revisar"}
                  </p>
                </li>
              ))}
            </ul>
          </figure>
        </div>
      </section>

      <footer className="bg-indigo-950">
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-10">
          <p
            aria-hidden="true"
            className="text-[clamp(4.5rem,20vw,15rem)] leading-[0.85] font-bold tracking-tight text-white"
          >
            Tiza<span className="text-amber-300">.ai</span>
          </p>
          <p className="mt-10 text-lg text-indigo-100">
            Prácticos y parciales de matemática para 6.º de bachillerato. Hecho en Montevideo.
          </p>
        </div>
      </footer>
    </PageTransition>
  );
}
