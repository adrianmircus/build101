import type { Metadata } from "next";
import { Suspense } from "react";
import { MyAssignments } from "@/components/student/MyAssignments";
import { Loading } from "@/components/ui/States";
import { secondaryButton } from "@/components/ui/styles";
import { PageTransition } from "@/components/ui/transitions";
import { logout } from "@/lib/auth/actions";
import { requireStudent } from "@/lib/auth/dal";

// The root layout's title and description talk about accessibility and adaptations: they must not show up here.
export const metadata: Metadata = { title: "Tus prácticos", description: "Tus prácticos y parciales de matemática." };

export default function StudentPage() {
  return (
    <PageTransition>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-4 pt-10 pb-16">
        <Suspense fallback={<Loading />}>
          <Content />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function Content() {
  const student = await requireStudent();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Hola, {student.name}</h1>
          <p className="mt-2 text-xl text-slate-700">Grupo {student.groupName}</p>
        </div>
        <form action={logout}>
          <button type="submit" className={secondaryButton}>
            Salir
          </button>
        </form>
      </div>
      <h2 className="mt-10 mb-4 text-2xl font-bold">Tus prácticos y parciales</h2>
      <MyAssignments studentId={student.id} groupId={student.groupId} />
    </>
  );
}
