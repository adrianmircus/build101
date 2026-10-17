"use client";

import { useRouter } from "next/navigation";
import { resetDemo } from "@/lib/groups/store";

// So every demo rehearsal starts with the same data.
export function ResetButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm text-slate-500 underline-offset-4 hover:underline"
      onClick={() => {
        if (!confirm("¿Volver a los datos de ejemplo? Se borran los grupos y prácticos que creaste.")) return;
        resetDemo();
        router.push("/groups");
      }}
    >
      Restaurar datos de ejemplo
    </button>
  );
}
