import { Suspense } from "react";
import { StudentGaze } from "@/components/student/gaze/StudentGaze";
import { StudentVoice } from "@/components/student/voice/StudentVoice";
import { requireViewer } from "./viewer";

// Shared by the student home and the solve screen: the eye-gaze session (camera and calibration) and the voice
// commands live here, so they start right after login and survive moving between screens. They only run for the demo:
// a real student has no assessments yet (phase 4), so there is nothing to look at or to say.
export default function StudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense>
      <WithGaze>{children}</WithGaze>
    </Suspense>
  );
}

async function WithGaze({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (viewer.kind === "real") return children;
  const { student } = viewer;
  return (
    <StudentGaze studentId={student.id} groupId={student.groupId}>
      <StudentVoice studentId={student.id} groupId={student.groupId}>
        {children}
      </StudentVoice>
    </StudentGaze>
  );
}
