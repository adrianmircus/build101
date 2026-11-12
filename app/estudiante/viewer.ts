import "server-only";
import { redirect } from "next/navigation";
import { demoStudentOf, readDemoSession, type DemoStudent } from "@/app/demo/session";
import { getActor } from "@/lib/server/auth/actor";

// Who is in the student area: a student with a real session (an empty home until phase 4) or the demo playing Paula.
export type Viewer = { kind: "real" } | { kind: "demo"; student: DemoStudent };

/** The real student or the demo's; anyone else goes to the student login. proxy.ts already filters: this is the real check. */
export async function requireViewer(): Promise<Viewer> {
  // The demo first: it needs no database, and proxy.ts drops its cookies when a real session is open, so both never meet.
  const student = demoStudentOf(await readDemoSession());
  if (student) return { kind: "demo", student };
  const actor = await getActor();
  if (actor?.kind === "student") return { kind: "real" };
  redirect("/ingresar/estudiante");
}
