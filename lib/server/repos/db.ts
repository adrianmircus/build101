import "server-only";
import { createSessionClient } from "../db/client";
import type { RpcDb } from "./rpc";

/**
 * The client of the session of this request, for the services that read with it (getActor and the services of the
 * panels). layers.mjs lets only a file of lib/server/repos import db/client.ts: this one hands the client out, so a
 * service never builds one. Call it per request, never at module level (it reads the cookies).
 */
export async function sessionDb(): Promise<RpcDb> {
  return createSessionClient();
}
