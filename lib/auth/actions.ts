"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_STUDENT } from "@/lib/demo/mode";
import { findAccount } from "./accounts";
import { isLocked, recordFailure, recordSuccess } from "./rateLimit";
import type { Role } from "./signing";
import { createSession, deleteSession, readSession, setDemoFlag } from "./session";

export type LoginState = { error?: string; username?: string };

const DESTINATION: Record<Role, string> = { teacher: "/grupos", student: "/estudiante" };

// The first address in x-forwarded-for is the client's. On Vercel the platform sets it, so it can't be faked.
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

async function login(role: Role, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const ip = await clientIp();
  // Checked before the password: once locked, not even the right one gets in until the window ends.
  if (await isLocked(ip, username)) {
    return { error: "Demasiados intentos fallidos. Esperá unos minutos y probá de nuevo, o pedile ayuda a tu profe.", username };
  }
  const account = findAccount(username, String(formData.get("password") ?? ""), role);
  // Generic message: doesn't reveal whether the user exists.
  if (!account) {
    await recordFailure(ip, username);
    return { error: "Usuario o contraseña incorrectos.", username };
  }
  await recordSuccess(ip, username);
  await createSession(account);
  // A real login leaves the demo: its own data, no tour.
  await setDemoFlag(false);
  redirect(DESTINATION[role]);
}

export async function loginTeacher(_previous: LoginState, formData: FormData) {
  return login("teacher", formData);
}

export async function loginStudent(_previous: LoginState, formData: FormData) {
  return login("student", formData);
}

export async function logout() {
  await deleteSession();
  await setDemoFlag(false);
  redirect("/");
}

// Inside the demo only: switches between the teacher and Paula, the student who answers with eye gaze.
// next is where to land (the tour's "Volver"); only paths inside that role's area are accepted.
export async function demoViewAs(role: Role, next?: string) {
  const session = await readSession();
  if (!session?.demo) return;
  await createSession(role === "teacher" ? { id: "teacher", role, demo: true } : { id: DEMO_STUDENT, role, demo: true });
  const area = role === "teacher" ? /^\/grupos(\/|$)/ : /^\/estudiante(\/|$)/;
  redirect(next && area.test(next) ? next : DESTINATION[role]);
}
