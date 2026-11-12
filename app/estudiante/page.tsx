import type { Metadata } from "next";
import { Suspense } from "react";
import { Assignments } from "@/components/student/GazeAssignments";
import { MyGrades } from "@/components/student/MyGrades";
import { Logo } from "@/components/ui/Logo";
import { Loading } from "@/components/ui/States";
import { secondaryButton } from "@/components/ui/styles";
import { PageTransition } from "@/components/ui/transitions";
import { SignOutButton } from "@/components/auth/staff/SignOutButton";
import { requireViewer } from "./viewer";

// The root layout's title and description talk about accessibility and adaptations: they must not show up here.
export const metadata: Metadata = { title: "Tus prácticos", description: "Tus prácticos y parciales de matemática." };

export default function StudentPage() {
  return (
    <PageTransition>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-4 pt-6 pb-16">
        <Logo className="mb-8 text-xl" />
        <Suspense fallback={<Loading />}>
          <Content />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function Content() {
  const viewer = await requireViewer();
  // A student with a real account has no assessments in the browser's storage and the server ones arrive in phase 4.
  if (viewer.kind === "real") {
    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-4xl font-bold tracking-tight">Tus prácticos</h1>
          <SignOutButton />
        </div>
        <p className="mt-10 text-xl text-slate-700">Todavía no tenés prácticos.</p>
      </>
    );
  }
  const { student } = viewer;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Hola, {student.name}</h1>
          <p className="mt-2 text-xl text-slate-700">Grupo {student.groupName}</p>
        </div>
        {/* The demo's way out: the same one as the demo bar. A plain link, so the full reload drops the demo's data. */}
        <a href="/demo/salir" className={secondaryButton}>
          Salir
        </a>
      </div>
      <h2 className="mt-10 mb-4 text-2xl font-bold">Tus prácticos y parciales</h2>
      <Assignments studentId={student.id} groupId={student.groupId} />
      <h2 id="calificaciones" tabIndex={-1} className="mt-12 mb-4 scroll-mt-6 text-2xl font-bold focus:outline-none">
        Calificaciones
      </h2>
      <MyGrades studentId={student.id} groupId={student.groupId} />
    </>
  );
}
