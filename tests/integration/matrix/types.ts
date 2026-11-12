import type { RpcName } from "@/lib/domain/rpc";
import type { RpcArgs } from "../support/session";
import type { Scene } from "./fixtures";

/**
 * One call of an operation, ready to run: valid arguments over fresh resources of the scene.
 * listing: the answer is a list or a projection, so a role that must not see the target may get
 * an answer, as long as it does not mention it. target: what an allowed role's answer contains.
 * sharedWithPeers: the other student of the group has the same right to see the target.
 */
export type Prepared = { args: RpcArgs; listing?: boolean; target?: string; sharedWithPeers?: boolean };
export type Call = (scene: Scene) => Promise<Prepared>;
export type CallsOf<N extends RpcName> = Record<N, Call>;
