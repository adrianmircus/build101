"use client";

import type { ReactNode } from "react";
import { useData } from "@/lib/groups/store";
import { usesGaze } from "@/lib/profiles";
import { GazeSession } from "./GazeSession";

// Right after login, students who answer with eye gaze get the camera on and calibrated for the whole student area.
// The profile is only read here to decide that: it's never shown.
export function StudentGaze({ studentId, groupId, children }: { studentId: string; groupId: string; children: ReactNode }) {
  const data = useData();
  const student = data?.groups.find((g) => g.id === groupId)?.students.find((s) => s.id === studentId);
  if (!student || !usesGaze(student.profiles)) return children;
  return <GazeSession autoStart>{children}</GazeSession>;
}
