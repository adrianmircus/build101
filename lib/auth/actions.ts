"use server";

import { redirect } from "next/navigation";
import { DEMO_STUDENT } from "@/lib/demo/mode";
import { findAccount } from "./accounts";
import type { Role } from "./signing";
import { createSession, deleteSession, readSession, setDemoFlag } from "./session";

export type LoginState = { error?: string; username?: string };

const DESTINATION: Record<Role, string> = { teacher: "/grupos", student: "/estudiante" };

async function login(role: Role, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const account = findAccount(username, String(formData.get("password") ?? ""), role);
  // Generic message: doesn't reveal whether the user exists.
  if (!account) return { error: "Usuario o contraseña incorrectos.", username };
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
