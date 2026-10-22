import { redirect } from "next/navigation";
import { deleteSession, setDemoFlag } from "@/lib/auth/session";

// Leaves the demo. It's reached with a plain <a>: the full reload drops the demo's data from memory.
export async function GET() {
  await deleteSession();
  await setDemoFlag(false);
  redirect("/");
}
