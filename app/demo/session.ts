import "server-only";
import { readSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/signing";
import { seed } from "@/lib/groups/seed";

// What the signed cookie of the demo says (it stays until T4.15). It opens the demo and nothing else: never a page of the
// institution and never a call to the server's data. Real sessions are read with getActor(), which ignores this cookie.

/** The demo session of this request, or null: no cookie, a forged or expired one, or one that is not marked as demo. */
export async function readDemoSession(): Promise<Session | null> {
  const session = await readSession();
  return session?.demo === true ? session : null;
}

/** What the student of the demo sees about themselves: name and group, never a profile. */
export type DemoStudent = { id: string; name: string; groupId: string; groupName: string };

/** The student of the demo (Paula) for a demo session as a student; null for the teacher or for an id the demo does not know. */
export function demoStudentOf(session: Session | null): DemoStudent | null {
  if (session?.demo !== true || session.role !== "student") return null;
  for (const group of seed().groups) {
    const student = group.students.find((item) => item.id === session.id);
    if (student) return { id: student.id, name: student.name, groupId: group.id, groupName: group.name };
  }
  return null;
}
