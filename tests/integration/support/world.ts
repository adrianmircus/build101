import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/server/db/admin";
import { isScratchDatabase, readRows, runRpc } from "./db";
import { idOf, type Actor } from "./session";

// Data for the race tests, built only through the RPCs (as the factories do) and committed: every
// test makes its own institution with a code nobody else has, so tests never share rows.

export const SERVICE: Actor = { role: "service_role" };

export type Role = "teacher" | "admin" | "inclusion";
export type World = { institutionId: string; teacher: string; groupId: string };

/** An Auth user. In a scratch copy of the database there is no Auth service: the row is written directly. */
export async function createAuthUser(): Promise<string> {
  const email = `${randomUUID()}@tiza-test.example`;
  if (isScratchDatabase()) {
    const id = randomUUID();
    await readRows("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    return id;
  }
  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    password: `${randomUUID()}${randomUUID()}`,
    email_confirm: true,
  });
  if (error) throw new Error(`No se pudo crear el usuario de prueba (${error.code ?? "sin código"}).`);
  return data.user.id;
}

/** An Auth user with its app_users row and no membership anywhere. */
export async function createPerson(): Promise<string> {
  const id = await createAuthUser();
  idOf(await runRpc(SERVICE, "internal_upsert_app_user", { p_user_id: id, p_display_name: "Persona de prueba" }));
  return id;
}

export async function createInstitution(): Promise<string> {
  const code = `race-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const outcome = await runRpc(SERVICE, "internal_create_institution", { p_name: `Colegio ${code}`, p_code: code, p_kind: "school" });
  return idOf(outcome);
}

export async function addMembership(institutionId: string, userId: string, role: string) {
  return runRpc(SERVICE, "internal_add_membership", { p_institution_id: institutionId, p_user_id: userId, p_role: role });
}

/** An institution with one teacher who owns one group. */
export async function createWorld(): Promise<World> {
  const institutionId = await createInstitution();
  const teacher = await createPerson();
  idOf(await addMembership(institutionId, teacher, "teacher"));
  const group = await runRpc({ role: "authenticated", userId: teacher }, "create_group", {
    p_institution_id: institutionId,
    p_name: "Grupo de carreras",
    p_subject_id: "math",
    p_school_year: 2027,
  });
  return { institutionId, teacher, groupId: idOf(group) };
}

/** Another group of the same teacher. */
export async function createGroup(world: World): Promise<string> {
  const outcome = await runRpc({ role: "authenticated", userId: world.teacher }, "create_group", {
    p_institution_id: world.institutionId,
    p_name: "Otro grupo",
    p_subject_id: "math",
    p_school_year: 2027,
  });
  return idOf(outcome);
}

export function teacherOf(world: World): Actor {
  return { role: "authenticated", userId: world.teacher };
}

/** A student created by the teacher, in the world's group (without an account). */
export async function createStudent(world: World, groupId: string = world.groupId): Promise<string> {
  const outcome = await runRpc(teacherOf(world), "create_student", {
    p_group_id: groupId,
    p_display_name: "Estudiante de prueba",
    p_username: `e${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    p_op_key: randomUUID(),
  });
  return idOf(outcome);
}
