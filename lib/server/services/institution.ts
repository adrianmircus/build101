import "server-only";
import type { InstitutionSummary, InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { unavailable } from "../unavailable";

// Reads and the group creation for the panel of the institution (T2.3). The pages are Server Components that call these.
// The RPCs check that the actor is an admin of the institution.

export type CreateGroup = { institutionId: string; name: string; subjectId: string; schoolYear: number; opKey: string };

export async function getInstitutionSummary(institutionId: string): Promise<InstitutionSummary> {
  return unavailable(institutionId);
}

export async function listStaff(institutionId: string): Promise<StaffRow[]> {
  return unavailable(institutionId);
}

export async function listInvitations(institutionId: string): Promise<InvitationView[]> {
  return unavailable(institutionId);
}

export async function listGroups(institutionId: string): Promise<GroupSummary[]> {
  return unavailable(institutionId);
}

/** The enabled subjects (list_enabled_subjects), for the group form; the Spanish name comes from the catalog in code. */
export async function listSubjects(): Promise<{ id: string }[]> {
  return unavailable();
}

/** create_group (phase 1). */
export async function createGroup(input: CreateGroup): Promise<{ id: string }> {
  return unavailable(input);
}
