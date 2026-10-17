import "server-only";
import { redirect } from "next/navigation";
import { getStudent, type PublicStudent } from "./accounts";
import { readSession } from "./session";

// proxy.ts already blocks access without a session; this is the real check on the server.
export async function requireStudent(): Promise<PublicStudent> {
  const session = await readSession();
  const student = session?.role === "student" ? getStudent(session.id) : null;
  if (!student) redirect("/ingresar/estudiante");
  return student;
}
