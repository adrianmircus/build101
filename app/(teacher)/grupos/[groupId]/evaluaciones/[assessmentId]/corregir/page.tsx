import type { Metadata } from "next";
import { Suspense } from "react";
import { GradeExercises } from "@/components/results/GradeExercises";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export const metadata: Metadata = { title: "Corregir", description: "Corregí las respuestas de tus estudiantes ejercicio por ejercicio." };

export default function GradePage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <GradeExercises />
      </Suspense>
    </PageTransition>
  );
}
