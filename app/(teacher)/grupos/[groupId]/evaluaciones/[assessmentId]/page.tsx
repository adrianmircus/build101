import { Suspense } from "react";
import { AssessmentDetail } from "@/components/assessments/AssessmentDetail";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export default function AssessmentPage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <AssessmentDetail />
      </Suspense>
    </PageTransition>
  );
}
