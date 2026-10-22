import { redirect } from "next/navigation";
import { createSession, setDemoFlag } from "@/lib/auth/session";

// "Probar la demo" on the landing: a teacher session marked as demo, with no login.
// ?tour=inicio tells the client to start the tour and the demo's data from scratch.
export async function GET() {
  await createSession({ id: "teacher", role: "teacher", demo: true });
  await setDemoFlag(true);
  redirect("/grupos?tour=inicio");
}
