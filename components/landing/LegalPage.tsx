import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export type LegalSection = { title: string; paragraphs: string[] };

// Privacy and terms: paper, plain text, and the way back to the landing.
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="bg-indigo-950">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="focus-on-dark inline-flex min-h-11 items-center rounded-md text-xl">
            <Logo tone="dark" />
          </Link>
          <Link
            href="/"
            className="focus-on-dark inline-flex min-h-11 items-center text-base font-semibold text-amber-300 underline underline-offset-4"
          >
            Volver al inicio
          </Link>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-16 lg:py-24">
        <h1 className="text-4xl leading-tight font-semibold sm:text-5xl">{title}</h1>
        <p className="mt-4 text-base text-slate-600">
          {updated}. Versión preliminar, en revisión. Si tenés dudas, escribinos a{" "}
          <a href="mailto:hola@usetiza.app" className="font-semibold text-slate-900 underline underline-offset-4">
            hola@usetiza.app
          </a>
          .
        </p>
        <div className="mt-12 space-y-12">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-2xl font-semibold">{section.title}</h2>
              <div className="mt-4 space-y-4 text-lg text-slate-700">
                {section.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
