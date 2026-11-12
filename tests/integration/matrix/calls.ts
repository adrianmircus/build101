import type { RpcName } from "@/lib/domain/rpc";
import { ASSESSMENT_CALLS } from "./calls-assessments";
import { DELIVERY_CALLS } from "./calls-delivery";
import { IDENTITY_CALLS } from "./calls-identity";
import { SENSITIVE_CALLS } from "./calls-sensitive";
import { VERSION_CALLS } from "./calls-versions";
import type { Call } from "./types";

// For each RPC of the contract, how to call it with valid arguments over a scene (the typecheck
// fails when a new RPC has no entry). Each call makes its own resources.

export const CALLS: Record<RpcName, Call> = {
  ...IDENTITY_CALLS,
  ...SENSITIVE_CALLS,
  ...ASSESSMENT_CALLS,
  ...VERSION_CALLS,
  ...DELIVERY_CALLS,
};
