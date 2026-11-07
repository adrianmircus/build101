import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { MathBackdrop } from "@/components/auth/MathBackdrop";
import { AUDIENCES, FAQ, SOURCES, STEPS } from "@/components/landing/content";
import { HeroBoard } from "@/components/landing/HeroBoard";
import { Listen } from "@/components/landing/Listen";
import { Nav } from "@/components/landing/Nav";
import { Reveal } from "@/components/landing/Reveal";
import { TaglineReveal } from "@/components/landing/TaglineReveal";
import { PageTransition } from "@/components/ui/transitions";
import { LANDING_EXAMPLE } from "@/lib/landing/example";
import { speechText } from "@/lib/speech/latexSpeech";

// Public landing (docs/LANDING.md, direction C). Two surfaces only, the board (indigo-950) and paper (white), with
// amber as the one accent on the board. No borders, dividers, tags or numbering: blocks are told apart by space.

const TITLE = "Tiza.ai · El mismo práctico, para cada estudiante";
const DESCRIPTION =
  "Cargás tu práctico de matemática una vez y Tiza.ai arma una versión para cada estudiante del grupo: TDAH, dislexia, TEA, motriz o disgrafía. Vos aprobás cada una.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://usetiza.app"),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, locale: "es_UY", type: "website", siteName: "Tiza.ai", url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// The FAQ as structured data, for search engines and AI answers (skill A7). "<" is escaped so no text closes the tag.
const FAQ_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
}).replace(/</g, "\\u003c");

// "Así suena un práctico": the recorded audio if scripts/landing-audio.ts made it, with the exact words it read.
// Without it, the browser's voice reads the same words the app would send to ElevenLabs.
function listenSource(): { text: string; src?: string } {
  const transcript = path.join(process.cwd(), "data", "landing", "audio.json");
  const mp3 = path.join(process.cwd(), "public", "landing", "consigna.mp3");
  if (fs.existsSync(transcript) && fs.existsSync(mp3)) {
    return { text: JSON.parse(fs.readFileSync(transcript, "utf8")).text, src: "/landing/consigna.mp3" };
  }
  return { text: speechText(LANDING_EXAMPLE.original) };
}

// A plain <a>: /demo sets the demo's cookies and the full reload makes the app pick its own data.
const demoButton =
  "focus-on-dark inline-flex min-h-11 items-center rounded-xl bg-amber-300 px-6 py-3 text-lg font-semibold text-indigo-950 transition-colors duration-300 ease-soft hover:bg-amber-200 active:translate-y-px";
const boardLink =
  "focus-on-dark inline-flex min-h-11 items-center text-lg font-semibold text-amber-300 underline underline-offset-4 transition-colors duration-300 ease-soft hover:text-amber-200";
const heading = "text-4xl leading-tight font-semibold sm:text-5xl";

export default function Home() {
  const listen = listenSource();
  return (
    <PageTransition>
      <div className="bg-indigo-950">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
        <Nav />

        <div className="relative isolate overflow-hidden">
          <MathBackdrop variant="still" />
          <main id="main-content" className="mx-auto max-w-6xl px-4 pt-32 pb-24 lg:pt-40 lg:pb-32">
            <HeroBoard />
          </main>
        </div>

        <section aria-labelledby="problem-heading" className="bg-white text-slate-900">
          <Reveal className="mx-auto grid max-w-6xl gap-12 px-4 py-24 lg:grid-cols-2 lg:py-32">
            <h2 id="problem-heading" className={`max-w-[680px] ${heading}`}>
              El mismo práctico no se lee igual en toda la clase
            </h2>
            <div className="space-y-6 text-lg text-slate-700 sm:text-xl">
              <p>
                En un mismo grupo conviven estudiantes con TDAH, con dislexia o con TEA, alguien que no puede escribir a
                mano y alguien que responde mejor hablando. Adaptar cada práctico para cada uno lleva un tiempo que casi
                nunca hay, y muchas veces esto implica una misma versión para todos.
              </p>
              <p className="font-semibold text-slate-900">
                Tiza.ai hace ese trabajo: arma una versión del práctico para cada perfil del grupo y te muestra cada
                cambio con su porqué.
              </p>
            </div>
          </Reveal>
        </section>

        <section aria-label="Lo que no cambia">
          <div className="mx-auto max-w-6xl px-4 py-32 lg:py-40">
            <TaglineReveal
              className="max-w-4xl text-4xl leading-tight font-semibold sm:text-6xl"
              lines={["Lo que se evalúa no cambia.", "Cambia cómo se presenta y cómo se responde, y vos ves cada cambio."]}
            />
          </div>
        </section>

        <section id="como-funciona" aria-labelledby="how-heading" className="scroll-mt-24 bg-white text-slate-900">
          <Reveal className="mx-auto max-w-6xl px-4 py-24 lg:py-32">
            <h2 id="how-heading" className={heading}>
              Cómo funciona
            </h2>
            <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <h3 className="text-2xl font-semibold">{step.title}</h3>
                  <p className="mt-4 text-lg text-slate-700">{step.body}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        <section aria-labelledby="audiences-heading" className="text-white">
          <Reveal className="mx-auto max-w-6xl px-4 py-24 lg:py-32">
            <h2 id="audiences-heading" className={`max-w-[680px] ${heading}`}>
              Para el aula, el colegio y la casa
            </h2>
            <div className="mt-16 grid gap-16 md:grid-cols-3 md:gap-8">
              {AUDIENCES.map((audience) => (
                <article
                  key={audience.id}
                  id={audience.id}
                  aria-labelledby={`${audience.id}-heading`}
                  className="scroll-mt-24"
                >
                  <h3 id={`${audience.id}-heading`} className="text-2xl font-semibold text-amber-300">
                    {audience.title}
                  </h3>
                  <ul className="mt-8 space-y-6">
                    {audience.items.map((item) => (
                      <li key={item.benefit} className="text-lg text-indigo-100">
                        <strong className="block font-semibold text-white">{item.benefit}</strong>
                        {item.detail}
                      </li>
                    ))}
                  </ul>
                  {audience.action && (
                    <a href={audience.action.href} className={`${boardLink} mt-8`}>
                      {audience.action.text}
                    </a>
                  )}
                </article>
              ))}
            </div>
          </Reveal>
        </section>

        <section aria-labelledby="listen-heading" className="text-white">
          <Reveal className="mx-auto max-w-6xl px-4 pb-24 lg:pb-32">
            <h2 id="listen-heading" className={`max-w-[680px] ${heading}`}>
              Así suena un práctico
            </h2>
            <p className="mt-6 mb-10 max-w-[680px] text-lg text-indigo-100 sm:text-xl">
              Con un botón, el estudiante lo escucha en voz alta, fórmulas incluidas. Esto es lo que se lee:
            </p>
            <Listen text={listen.text} display={LANDING_EXAMPLE.original} src={listen.src} />
          </Reveal>
        </section>

        {/* Two white sections in a row would leave a sub-pixel seam of board between them: these share one block. */}
        <div className="bg-white text-slate-900">
          <section aria-labelledby="sources-heading">
            <Reveal className="mx-auto grid max-w-6xl gap-12 px-4 py-24 lg:grid-cols-[5fr_6fr] lg:py-32">
              <div>
                <h2 id="sources-heading" className={heading}>
                  De dónde salen las adaptaciones
                </h2>
                <p className="mt-8 text-lg text-slate-700 sm:text-xl">
                  Las adaptaciones de TDAH, dislexia y TEA están escritas a partir de guías publicadas y las revisó el
                  equipo docente. Para esos perfiles, el agente se basa en esas guías y cada cambio te dice de cuál salió.
                  Lo que no sale de una guía, como responder con la mirada o dictando, usar los gustos del grupo o los
                  apoyos que habilitás vos, también aparece en la lista de cambios, con su motivo.
                </p>
              </div>
              <ul className="space-y-4 lg:pt-4">
                {SOURCES.map((source) => (
                  <li key={source.href}>
                    <a
                      href={source.href}
                      className="inline-flex min-h-11 items-center text-lg text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors duration-300 ease-soft hover:decoration-slate-900"
                    >
                      {source.text}
                    </a>
                  </li>
                ))}
              </ul>
            </Reveal>
          </section>

          <section id="preguntas" aria-labelledby="faq-heading" className="scroll-mt-24">
            <Reveal className="mx-auto max-w-3xl px-4 pb-24 lg:pb-32">
              <h2 id="faq-heading" className={heading}>
                Preguntas frecuentes
              </h2>
              <div className="mt-12 space-y-2">
                {FAQ.map((item) => (
                  <details
                    key={item.q}
                    className="group rounded-2xl transition-colors duration-300 ease-soft open:bg-slate-50"
                  >
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 rounded-2xl px-6 py-5 text-xl font-semibold transition-colors duration-300 ease-soft hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                      {item.q}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-6 shrink-0 fill-none stroke-slate-900 stroke-2 transition-transform duration-300 ease-soft group-open:rotate-45"
                      >
                        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                      </svg>
                    </summary>
                    <p className="px-6 pb-6 text-lg text-slate-700">{item.a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          </section>
        </div>

        <section aria-labelledby="cta-heading" className="relative isolate overflow-hidden">
          <MathBackdrop variant="still" />
          <Reveal className="mx-auto max-w-6xl px-4 py-32 lg:py-40">
            <h2 id="cta-heading" className="max-w-[680px] text-4xl leading-tight font-semibold text-white sm:text-6xl">
              Probá Tiza.ai con un práctico de verdad
            </h2>
            <p className="mt-8 max-w-[680px] text-lg text-indigo-50 sm:text-xl">
              Armás las versiones de un grupo, revisás cada cambio y ves el práctico como lo ve una estudiante.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href="/demo" className={demoButton}>
                Probar la demo
              </a>
              <p className="text-base text-indigo-100">Sin cuenta · 3 minutos</p>
            </div>
          </Reveal>
        </section>

        <footer className="mx-auto max-w-6xl px-4 pt-16 pb-12">
          <p aria-hidden="true" className="text-7xl leading-none font-semibold text-white sm:text-9xl">
            Tiza<span className="text-amber-300">.ai</span>
          </p>
          <p className="mt-12 text-lg text-indigo-100">
            Prácticos de matemática para bachillerato. Hecho en Montevideo.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-6">
            <li>
              <Link href="/ingresar/profesor" className={boardLink}>
                Soy profesor
              </Link>
            </li>
            <li>
              <Link href="/ingresar/estudiante" className={boardLink}>
                Soy estudiante
              </Link>
            </li>
            <li>
              <a href="mailto:hola@usetiza.app" className={boardLink}>
                hola@usetiza.app
              </a>
            </li>
            <li>
              <Link href="/privacidad" className={boardLink}>
                Privacidad
              </Link>
            </li>
            <li>
              <Link href="/terminos" className={boardLink}>
                Términos
              </Link>
            </li>
          </ul>
        </footer>
      </div>
    </PageTransition>
  );
}
