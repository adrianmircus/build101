import { randomUUID } from "node:crypto";
import { callRpc, type RpcDb } from "@/lib/server/repos/rpc";

// Every test makes its own institution with a code nobody else has, so tests never share rows and
// can run in any order (or in parallel) against the same local database.

export type TestInstitution = { id: string; code: string; name: string };

type InstitutionOptions = { name?: string; kind?: "school" | "sandbox" };

export function uniqueCode(prefix = "t"): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export async function createInstitution(admin: RpcDb, options: InstitutionOptions = {}): Promise<TestInstitution> {
  const code = uniqueCode();
  const name = options.name ?? `Institución de prueba ${code}`;
  const { id } = await callRpc(admin, "internal_create_institution", {
    p_name: name,
    p_code: code,
    p_kind: options.kind ?? "school",
  });
  return { id, code, name };
}
