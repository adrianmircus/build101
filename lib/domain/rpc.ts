import type { z } from "zod";
import { ASSESSMENT_RPCS } from "./assessments/rpc";
import { GENERATION_RPCS } from "./assessments/rpc-generations";
import { VERSION_RPCS } from "./assessments/rpc-versions";
import { DELIVERY_RPCS } from "./delivery/rpc";
import { GROUP_RPCS } from "./groups/rpc";
import { IDENTITY_RPCS } from "./identity/rpc";
import { SENSITIVE_RPCS } from "./students/rpc-sensitive";
import { STUDENT_RPCS } from "./students/rpc";

// Every RPC of the contract, by name: args keyed like the SQL parameters, result as the jsonb it
// returns. Repos validate args before the call and the result after it (zod at every border).
// lib/server/db/rpc-contract.ts checks at compile time that this registry and the generated
// database types name the same functions with compatible arguments.

export const RPCS = {
  ...IDENTITY_RPCS,
  ...GROUP_RPCS,
  ...STUDENT_RPCS,
  ...SENSITIVE_RPCS,
  ...ASSESSMENT_RPCS,
  ...VERSION_RPCS,
  ...GENERATION_RPCS,
  ...DELIVERY_RPCS,
} as const;

export type RpcName = keyof typeof RPCS;
export type RpcArgs<N extends RpcName> = z.input<(typeof RPCS)[N]["args"]>;
export type RpcResult<N extends RpcName> = z.output<(typeof RPCS)[N]["result"]>;

export const RPC_NAMES = Object.keys(RPCS).filter((name): name is RpcName => Object.hasOwn(RPCS, name));

/** Internal RPCs are granted to service_role only, never to a user role. */
export function isInternalRpc(name: string): boolean {
  return name.startsWith("internal_");
}
