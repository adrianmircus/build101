import { Suspense } from "react";
import { NewAssessment } from "@/components/assessments/NewAssessment";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export default function NewAssessmentPage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <NewAssessment />
      </Suspense>
    </PageTransition>
  );
}
