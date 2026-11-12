"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { DEMO_STUDENT } from "@/lib/demo/mode";
import { readDemoSession } from "./session";

// Inside the demo only: switches between the teacher and Paula, the student who answers with eye gaze.
// next is where to land (the tour's "Volver"); only paths inside that role's area are accepted. Without a demo session
// it does nothing: this action never opens anything for someone who is not in the demo.
export async function demoViewAs(role: "teacher" | "student", next?: string) {
  if (role !== "teacher" && role !== "student") return;
  if (!(await readDemoSession())) return;
  await createSession(role === "teacher" ? { id: "teacher", role, demo: true } : { id: DEMO_STUDENT, role, demo: true });
  const area = role === "teacher" ? /^\/grupos(\/|$)/ : /^\/estudiante(\/|$)/;
  redirect(typeof next === "string" && area.test(next) ? next : role === "teacher" ? "/grupos" : "/estudiante");
}
