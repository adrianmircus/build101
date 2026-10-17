import { Suspense } from "react";
import { AssessmentDetail } from "@/components/assessments/AssessmentDetail";
import { Loading } from "@/components/ui/States";

export default function AssessmentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AssessmentDetail />
    </Suspense>
  );
}
