"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const LINKS = [
  { href: "/grupos", text: "Mis grupos" },
  { href: "/materia", text: "Mi materia" },
];

// Teacher's main navigation: the current section is marked with aria-current and a solid underline.
// With cacheComponents, usePathname suspends under dynamic params ([groupId]): the fallback is the
// same list without the active mark, so nothing jumps.
export function MainNav() {
  return (
    <Suspense fallback={<Links pathname={null} />}>
      <ActiveLinks />
    </Suspense>
  );
}

function ActiveLinks() {
  return <Links pathname={usePathname()} />;
}

function Links({ pathname }: { pathname: string | null }) {
  return (
    <ul className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = pathname !== null && (pathname === link.href || pathname.startsWith(`${link.href}/`));
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-lg font-semibold transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-950 underline decoration-indigo-700 decoration-[3px] underline-offset-8"
                  : "text-indigo-800 underline-offset-4 hover:bg-slate-100 hover:underline"
              }`}
            >
              {link.text}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
