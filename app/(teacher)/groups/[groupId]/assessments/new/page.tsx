import { Suspense } from "react";
import { NewAssessment } from "@/components/assessments/NewAssessment";
import { Loading } from "@/components/ui/States";

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewAssessment />
    </Suspense>
  );
}
