import { randomUUID } from "node:crypto";
import { createLoggedInUser, createSchool, type LoggedInUser, type School } from "../../factories";
import { readRows } from "../support/db";
import { invitationToken, latestMailTo } from "../support/mailbox";
import { openSession } from "../support/cookie-jar";

// Shared by the tests of the invitations (T2.3): a school with an admin whose session is in the jar of the "browser", and the
// small questions about what the database ended up with.

export const ORIGIN = "http://localhost:3000";
export const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
export const email = () => `${randomUUID()}@tiza-test.example`;
export const strongPassword = () => `${randomUUID()}${randomUUID()}`.slice(0, 40);

const used = new Set<string>();

/** Removes the institutions of the test: a revoked or accepted invitation is final and is never deleted but with its institution, and the pgTAP files of phase 1 update every invitation of the table. */
export async function purgeSchools(): Promise<void> {
  const ids = [...used];
  used.clear();
  if (ids.length > 0) await readRows("delete from app.institutions where id = any(string_to_array($1, ',')::uuid[])", [ids.join(",")]);
}

export type AdminSchool = School & { owner: LoggedInUser };

/** A school with an admin; `openAsAdmin()` puts that admin's session in the jar. */
export async function adminSchool(): Promise<AdminSchool & { openAsAdmin: () => Promise<void> }> {
  const school = await createSchool();
  used.add(school.institution.id);
  const owner = await createLoggedInUser(school.admin, school.institution, "admin");
  return { ...school, owner, openAsAdmin: async () => void (await openSession(owner)) };
}

/** The token that came in the mail to that address (waits for the mail). */
export async function tokenSentTo(address: string, after = 0): Promise<string> {
  const mail = await latestMailTo(address, { after });
  if (mail === null) throw new Error("No llegó el correo de la invitación.");
  return invitationToken(mail);
}

const count = async (sql: string, values: string[]) => Number((await readRows<{ n: string }>(sql, values))[0]?.n);

export const membershipsOf = (userId: string, institutionId: string) =>
  count("select count(*)::text as n from app.memberships where user_id = $1 and institution_id = $2 and revoked_at is null", [userId, institutionId]);

export const authUsersWith = (address: string) => count("select count(*)::text as n from auth.users where lower(email) = lower($1)", [address]);

export const invitationRow = async (institutionId: string, address: string) =>
  (await readRows<{ id: string; status: string; revision: number; sent: boolean }>(
    "select id, status, revision, sent_at is not null as sent from app.invitations where institution_id = $1 and email = $2 order by created_at desc limit 1",
    [institutionId, address],
  ))[0];
