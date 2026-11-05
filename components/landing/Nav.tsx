"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { revealAll } from "./Reveal";

const LINKS = [
  { href: "#como-funciona", text: "Cómo funciona" },
  { href: "#colegios", text: "Colegios" },
  { href: "#familias", text: "Familias" },
  { href: "#preguntas", text: "Preguntas" },
];

const item =
  "focus-on-dark inline-flex min-h-11 items-center rounded-xl px-3 text-base text-indigo-100 transition-colors duration-300 ease-soft hover:text-white";

// The landing's floating nav (skill B7): centered, translucent over a blur. On phones the section links go into a
// full-height menu; the toggle's two lines turn into an X, and the links come in one after another.
export function Nav() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  // While the menu is open: the page behind doesn't scroll, Esc closes it, and focus goes in and back out.
  useEffect(() => {
    if (!open) return;
    const button = toggle.current;
    document.body.style.overflow = "hidden";
    firstLink.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      button?.focus();
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      {/* Above the open menu, so the toggle that closes it stays on top. */}
      <nav aria-label="Principal" className="relative z-50 flex items-center gap-2 rounded-2xl bg-indigo-950/80 py-2 pr-2 pl-5 backdrop-blur-xl">
        <Link href="/" className="focus-on-dark mr-2 inline-flex min-h-11 items-center rounded-md text-xl md:mr-4">
          <Logo tone="dark" />
        </Link>
        <ul className="hidden items-center md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={revealAll} className={item}>
                {link.text}
              </a>
            </li>
          ))}
        </ul>
        <Link
          href="/ingresar/profesor"
          className="focus-on-dark inline-flex min-h-11 items-center rounded-xl px-4 text-base font-semibold text-white transition-colors duration-300 ease-soft hover:bg-indigo-900"
        >
          Ingresar
        </Link>
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls="landing-menu"
          aria-label={open ? "Cerrar el menú" : "Abrir el menú"}
          onClick={() => setOpen((o) => !o)}
          className="focus-on-dark inline-flex size-11 items-center justify-center rounded-xl text-white transition-colors duration-300 ease-soft hover:bg-indigo-900 md:hidden"
        >
          <span aria-hidden="true" className="relative block h-3.5 w-5">
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ease-soft ${open ? "top-1.5 rotate-45" : "top-0"}`}
            />
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ease-soft ${open ? "top-1.5 -rotate-45" : "top-3"}`}
            />
          </span>
        </button>
      </nav>

      {open && (
        <div
          id="landing-menu"
          className="fixed inset-0 z-40 flex flex-col justify-center bg-indigo-950/95 px-8 backdrop-blur-2xl md:hidden"
        >
          <ul className="space-y-4">
            {LINKS.map((link, i) => (
              <li key={link.href} className="menu-in" style={{ animationDelay: `${i * 60}ms` }}>
                <a
                  ref={i === 0 ? firstLink : undefined}
                  href={link.href}
                  onClick={() => {
                    revealAll();
                    setOpen(false);
                  }}
                  className="focus-on-dark inline-flex min-h-11 items-center text-4xl font-semibold text-white"
                >
                  {link.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
