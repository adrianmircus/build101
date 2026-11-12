import type { Metadata } from "next";
import { Suspense } from "react";
import { SolveAssessment } from "@/components/solve/SolveAssessment";
import { Logo } from "@/components/ui/Logo";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";
import { redirect } from "next/navigation";
import { requireViewer } from "../viewer";

// Same as the student home: nothing about accessibility or adaptations in the title.
export const metadata: Metadata = { title: "Resolver", description: "Resolvé tu práctico o parcial de matemática." };

export default function SolvePage() {
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
  // A real student has nothing to solve until phase 4: back to the home, which says so.
  if (viewer.kind === "real") redirect("/estudiante");
  return <SolveAssessment studentId={viewer.student.id} groupId={viewer.student.groupId} />;
}
