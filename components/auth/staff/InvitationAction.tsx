import type { ReactNode } from "react";

/** The card with the one action of the screen (maqueta: «.act»). */
export function InvitationAction({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-8 space-y-6 rounded-2xl bg-white p-5 shadow-lg shadow-slate-900/10 sm:p-8">
      {title && <h2 className="text-2xl font-bold">{title}</h2>}
      {children}
    </div>
  );
}
