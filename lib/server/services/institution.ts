import "server-only";
import type { InstitutionSummary, InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { createGroup as createGroupRow, listMyGroups } from "../repos/groups";
import { sessionDb } from "../repos/db";
import * as panel from "../repos/institution";
import { listInvitations as listInvitationRows } from "../repos/invitations";

// Reads and the group creation for the panel of the institution (T2.3). The pages are Server Components that call these.
// The RPCs check that the actor is an admin of the institution: nothing is decided here.

export type CreateGroup = { institutionId: string; name: string; subjectId: string; schoolYear: number; opKey: string };

/** The most groups the panel lists at once (the cap of list_my_groups). */
const GROUPS_LIMIT = 200;

export async function getInstitutionSummary(institutionId: string): Promise<InstitutionSummary> {
  return panel.getInstitutionSummary(await sessionDb(), institutionId);
}

export async function listStaff(institutionId: string): Promise<StaffRow[]> {
  return panel.listInstitutionStaff(await sessionDb(), institutionId);
}

export async function listInvitations(institutionId: string): Promise<InvitationView[]> {
  return listInvitationRows(await sessionDb(), institutionId);
}

/** The groups of the institution (the admin sees all of them, the archived ones apart). */
export async function listGroups(institutionId: string): Promise<GroupSummary[]> {
  const page = await listMyGroups(await sessionDb(), institutionId, { limit: GROUPS_LIMIT });
  return page.items;
}

/** The enabled subjects (list_enabled_subjects), for the group form; the Spanish name comes from the catalog in code. */
export async function listSubjects(): Promise<{ id: string }[]> {
  return panel.listEnabledSubjects(await sessionDb());
}

/** create_group (phase 1): the same `opKey` never creates the group twice. */
export async function createGroup(input: CreateGroup): Promise<{ id: string }> {
  const { id } = await createGroupRow(await sessionDb(), input);
  return { id };
}
