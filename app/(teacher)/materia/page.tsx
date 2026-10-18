import type { Metadata } from "next";
import { SyllabusEditor } from "@/components/syllabus/SyllabusEditor";
import { PageTransition } from "@/components/ui/transitions";

export const metadata: Metadata = { title: "Mi materia", description: "El temario de tu materia, que el agente usa para adaptar los prácticos." };

export default function SubjectPage() {
  return (
    <PageTransition>
      <SyllabusEditor />
    </PageTransition>
  );
}
