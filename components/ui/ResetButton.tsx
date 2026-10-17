"use client";

import { useRouter } from "next/navigation";
import { resetDemo } from "@/lib/groups/store";

// So every demo rehearsal starts with the same data.
export function ResetButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center rounded-lg px-3 text-base text-slate-700 underline underline-offset-4 transition-colors hover:bg-slate-100 hover:text-slate-900"
      onClick={() => {
        if (!confirm("¿Volver a los datos de ejemplo? Se borran los grupos y prácticos que creaste.")) return;
        resetDemo();
        router.push("/grupos");
      }}
    >
      Restaurar datos de ejemplo
    </button>
  );
}
