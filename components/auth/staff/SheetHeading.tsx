import type { ReactNode } from "react";

export function SheetHeading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <>
      <h1 className="text-3xl font-bold">{title}</h1>
      {lead && <p className="mt-2 text-lg text-slate-700">{lead}</p>}
    </>
  );
}
