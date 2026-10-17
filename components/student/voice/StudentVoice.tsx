"use client";

import type { ReactNode } from "react";
import { useData } from "@/lib/groups/store";
import { usesVoice } from "@/lib/profiles";
import { VoiceCommands } from "./VoiceCommands";

// Students with writing difficulties also move around by voice in the whole student area.
// Like StudentGaze, the profile is only read here to decide that: it's never shown.
export function StudentVoice({ studentId, groupId, children }: { studentId: string; groupId: string; children: ReactNode }) {
  const data = useData();
  const student = data?.groups.find((g) => g.id === groupId)?.students.find((s) => s.id === studentId);
  if (!student || !usesVoice(student.profiles)) return children;
  return <VoiceCommands>{children}</VoiceCommands>;
}
