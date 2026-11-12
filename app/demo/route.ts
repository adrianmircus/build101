import { redirect } from "next/navigation";
import { createSession, setDemoFlag } from "@/lib/auth/session";
import { signOut } from "@/lib/server/services/staff-auth";

// "Probar la demo" on the landing: a teacher session marked as demo, with no login.
// ?tour=inicio tells the client to start the tour and the demo's data from scratch.
export async function GET() {
  // Someone with a real session who enters the demo leaves it first: the two never live together.
  await signOut().catch(() => undefined);
  await createSession({ id: "teacher", role: "teacher", demo: true });
  await setDemoFlag(true);
  redirect("/grupos?tour=inicio");
}
