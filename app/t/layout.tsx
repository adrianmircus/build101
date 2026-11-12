import type { Metadata } from "next";
import { Suspense } from "react";
import { MathBackdrop } from "@/components/auth/MathBackdrop";
import { loginGate } from "@/lib/server/auth/login-gate";

// The link of a card carries a secret in its fragment: no referrer, and no search engine has any business with it.
export const metadata: Metadata = {
  title: "Tu tarjeta",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// A student who is already inside goes home, if the database recognizes the session (F2-5). It does not clean a stale one:
// a layout does not see the query, and the login of the card overwrites those cookies anyway.
async function CardGate() {
  await loginGate("student", { canClean: false });
  return null;
}

export default function CardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <MathBackdrop />
      <Suspense>
        <CardGate />
      </Suspense>
      {children}
    </div>
  );
}