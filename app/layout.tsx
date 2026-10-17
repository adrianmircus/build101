import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prácticos accesibles",
  description: "Prácticos y parciales de matemática adaptados a cada estudiante del grupo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold"
        >
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
