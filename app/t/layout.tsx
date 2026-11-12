import type { Metadata } from "next";
import { MathBackdrop } from "@/components/auth/MathBackdrop";

// The link of a card carries a secret in its fragment: no referrer, and no search engine has any business with it.
export const metadata: Metadata = {
  title: "Tu tarjeta",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <MathBackdrop />
      {children}
    </div>
  );
}
