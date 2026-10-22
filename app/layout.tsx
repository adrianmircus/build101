import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import { Suspense } from "react";
import { Demo } from "@/components/demo/Demo";
import "./globals.css";

// Wide, legible typeface for the projector. Not Atkinson Hyperlegible: its slashed zero reads like ∅
// (empty set), which is confusing in a math worksheet. Exposed as --font-sans in globals.css.
const lexend = Lexend({ subsets: ["latin", "latin-ext"], variable: "--font-lexend" });

export const metadata: Metadata = {
  title: { default: "Tiza.ai", template: "%s · Tiza.ai" },
  description: "Prácticos y parciales de matemática adaptados a cada estudiante del grupo.",
  applicationName: "Tiza.ai",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={lexend.variable}>
      <body className="min-h-screen antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-lg focus:font-semibold focus:text-slate-900 focus:shadow-lg"
        >
          Saltar al contenido
        </a>
        {/* The guided demo from the landing (bar and tour); nothing outside the demo. usePathname needs the boundary. */}
        <Suspense fallback={null}>
          <Demo />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
