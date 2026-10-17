"use server";

import { redirect } from "next/navigation";
import { findAccount } from "./accounts";
import type { Role } from "./signing";
import { createSession, deleteSession } from "./session";

export type LoginState = { error?: string; username?: string };

const DESTINATION: Record<Role, string> = { teacher: "/grupos", student: "/estudiante" };

async function login(role: Role, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const account = findAccount(username, String(formData.get("password") ?? ""), role);
  // Generic message: doesn't reveal whether the user exists.
  if (!account) return { error: "Usuario o contraseña incorrectos.", username };
  await createSession(account);
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
  redirect("/");
}
