import { SyllabusEditor } from "@/components/syllabus/SyllabusEditor";
import { PageTransition } from "@/components/ui/transitions";

export default function SubjectPage() {
  return (
    <PageTransition>
      <SyllabusEditor />
    </PageTransition>
  );
}
