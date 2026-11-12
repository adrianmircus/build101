import { randomUUID } from "node:crypto";
import pg from "pg";
import { adminClient, createStaffAccount, idOf, publishableClient, rpc, type StaffAccount } from "./accounts";
import { localStack } from "./env";
import { clearWorld, setWorld } from "./world";

// One school per run, so every run is independent of the last one and of anyone else's data: an institution with its own code, an admin
// with a password, a teacher with a password and a group of math. It is made through the same RPCs the platform uses (never with
// SQL), with the secret key of the local Supabase, and deleted when the run ends.
//
// The server under test is already up when this runs (Playwright starts the webServer first), and the specs read the world
// from the environment (see world.ts): the workers inherit it.

const GROUP_NAME = "4.º B";

/** The group is made by the admin, as a person of the platform would. */
async function createGroupAs(account: StaffAccount, institutionId: string): Promise<string> {
  const client = publishableClient();
  const signedIn = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (signedIn.error) throw new Error("No se pudo entrar con el admin de prueba.");
  const id = idOf(await rpc(client, "create_group", { p_institution_id: institutionId, p_name: GROUP_NAME, p_subject_id: "math", p_school_year: 2027, p_op_key: randomUUID() }));
  await client.auth.signOut();
  return id;
}

/** Deletes the school (everything hangs from it) and then the people: its members and the accounts of its students, made by the specs. */
async function cleanUp(institutionId: string): Promise<void> {
  const admin = adminClient();
  const db = new pg.Client({ connectionString: localStack().dbUrl });
  await db.connect();
  try {
    const people = await db.query<{ id: string }>(
      `select user_id as id from app.memberships where institution_id = $1
       union select auth_user_id from app.account_provisioning where institution_id = $1 and auth_user_id is not null`,
      [institutionId],
    );
    await db.query("delete from app.institutions where id = $1", [institutionId]);
    for (const { id } of people.rows) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.warn("No se pudo borrar una cuenta de prueba de la corrida.");
    }
  } finally {
    await db.end();
  }
}

// Playwright asks for the default export of the module: it is the only one here.
// eslint-disable-next-line no-restricted-exports
export default async function globalSetup(): Promise<() => Promise<void>> {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const institution = { id: "", code: `e2e-${run}`, name: `Colegio de prueba ${run}` };
  institution.id = idOf(await rpc(adminClient(), "internal_create_institution", { p_name: institution.name, p_code: institution.code, p_kind: "school" }));

  const admin = await createStaffAccount(institution.id, "admin", "Marta Admin");
  const teacher = await createStaffAccount(institution.id, "teacher", "Pablo Profe");
  const groupId = await createGroupAs(admin, institution.id);
  setWorld({ institution, admin, teacher, group: { id: groupId, name: GROUP_NAME }, run });

  return async () => {
    clearWorld();
    await cleanUp(institution.id);
  };
}
