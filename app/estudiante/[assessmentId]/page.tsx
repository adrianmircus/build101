import type { Metadata } from "next";
import { Suspense } from "react";
import { SolveAssessment } from "@/components/solve/SolveAssessment";
import { Logo } from "@/components/ui/Logo";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";
import { requireStudent } from "@/lib/auth/dal";

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
  const student = await requireStudent();
  return <SolveAssessment studentId={student.id} groupId={student.groupId} />;
}
