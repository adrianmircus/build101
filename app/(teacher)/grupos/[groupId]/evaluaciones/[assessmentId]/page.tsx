import type { Metadata } from "next";
import { Suspense } from "react";
import { AssessmentDetail } from "@/components/assessments/AssessmentDetail";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export const metadata: Metadata = { title: "Revisar versiones", description: "Revisá, corregí y aprobá cada versión adaptada del práctico." };

export default function AssessmentPage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <AssessmentDetail />
      </Suspense>
    </PageTransition>
  );
}
