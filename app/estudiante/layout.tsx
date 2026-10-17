import { Suspense } from "react";
import { StudentGaze } from "@/components/student/gaze/StudentGaze";
import { StudentVoice } from "@/components/student/voice/StudentVoice";
import { requireStudent } from "@/lib/auth/dal";

// Shared by the student home and the solve screen: the eye-gaze session (camera and calibration) and the voice
// commands live here, so they start right after login and survive moving between screens.
export default function StudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense>
      <WithGaze>{children}</WithGaze>
    </Suspense>
  );
}

async function WithGaze({ children }: { children: React.ReactNode }) {
  const student = await requireStudent();
  return (
    <StudentGaze studentId={student.id} groupId={student.groupId}>
      <StudentVoice studentId={student.id} groupId={student.groupId}>
        {children}
      </StudentVoice>
    </StudentGaze>
  );
}
