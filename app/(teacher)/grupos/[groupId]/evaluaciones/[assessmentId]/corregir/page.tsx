import { Suspense } from "react";
import { GradeExercises } from "@/components/results/GradeExercises";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export default function GradePage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <GradeExercises />
      </Suspense>
    </PageTransition>
  );
}
