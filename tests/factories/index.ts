import type { MemberRole } from "@/lib/domain/identity/entities";
import { createAdminClient, type AdminClient } from "@/lib/server/db/admin";
import { createUserClient, type TestClient } from "./clients";
import { createInstitution, type TestInstitution } from "./institutions";
import { createUser, type TestUser } from "./users";

export { createUserClient, type TestClient } from "./clients";
export { createGroup, type GroupOptions } from "./groups";
export { createInstitution, uniqueCode, type TestInstitution } from "./institutions";
export { createUser, type TestUser, type UserOptions } from "./users";

export type LoggedInUser = TestUser & { client: TestClient };

/** A user of that institution with a role, already logged in. */
export async function createLoggedInUser(
  admin: AdminClient,
  institution: TestInstitution,
  role: MemberRole,
): Promise<LoggedInUser> {
  const user = await createUser(admin, { institutionId: institution.id, role });
  return { ...user, client: await createUserClient(user) };
}

export type School = { admin: AdminClient; institution: TestInstitution; teacher: LoggedInUser };

/** The usual starting point of a test: its own institution and one logged-in teacher. */
export async function createSchool(): Promise<School> {
  const admin = createAdminClient();
  const institution = await createInstitution(admin);
  const teacher = await createLoggedInUser(admin, institution, "teacher");
  return { admin, institution, teacher };
}
