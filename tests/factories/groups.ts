import { callRpc, type RpcDb } from "@/lib/server/repos/rpc";

// A group is always made through create_group, as the logged-in teacher: the creator becomes owner.

export type GroupOptions = { name?: string; subjectId?: string; schoolYear?: number };

export async function createGroup(teacher: RpcDb, institutionId: string, options: GroupOptions = {}) {
  return callRpc(teacher, "create_group", {
    p_institution_id: institutionId,
    p_name: options.name ?? "Grupo de prueba",
    // The subject is a parameter; the default is one the database has switched on.
    p_subject_id: options.subjectId ?? "math",
    p_school_year: options.schoolYear ?? 2027,
  });
}
