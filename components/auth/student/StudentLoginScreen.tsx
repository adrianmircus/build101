"use client";

import { StudentLogin } from "./StudentLogin";
import { StudentShell } from "./StudentShell";
import { useRememberedSchool } from "./useRememberedSchool";

/** /ingresar/estudiante. Waits to know whether there is a remembered school so the form doesn't jump from three fields to two. */
export function StudentLoginScreen() {
  const remembered = useRememberedSchool();
  return (
    <StudentShell>
      {remembered === undefined ? (
        <>
          <h1 className="text-3xl font-bold">Entrá con tu tarjeta</h1>
          <p role="status" className="mt-2 text-lg text-slate-700">
            Un momento…
          </p>
        </>
      ) : (
        <StudentLogin remembered={remembered} />
      )}
    </StudentShell>
  );
}
