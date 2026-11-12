import "server-only";
import { RPCS, type RpcArgs, type RpcName, type RpcResult } from "@/lib/domain/rpc";
import { parseRpcError, type RpcErrorLike } from "@/lib/domain/errors/rpcError";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/server/log";

// The single door to the database for every repo: arguments and result go through the zod schemas
// of the registry, an expected failure (P0001 + known code) becomes AppError with its Spanish
// message, and anything else becomes an UnexpectedRpcError that carries no data from the database.

type RpcResponse = { data: unknown; error: RpcErrorLike | null };

/** What the supabase-js rpc builder gives back: awaitable, and it can add a header to the request. */
export type RpcBuilder = PromiseLike<RpcResponse> & { setHeader(name: string, value: string): RpcBuilder };

/** The part of a Supabase client callRpc needs. SessionClient and AdminClient fit; a test can fake it. */
export type RpcDb = { rpc<N extends RpcName>(name: N, args: RpcArgs<N>): RpcBuilder };

/** A bug or an outage, not a case the user can fix. The message is fixed text: it never carries data. */
export class UnexpectedRpcError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Falló una llamada a la base de datos.");
    this.name = "UnexpectedRpcError";
    this.code = code;
  }
}

function unexpected(name: RpcName, code: string): UnexpectedRpcError {
  // Only the RPC name and a code: never the arguments, the response or the database message.
  log.error("rpc.unexpected", { entry: name, errorCode: code });
  return new UnexpectedRpcError(code);
}

function errorCodeOf(error: RpcErrorLike): string {
  return typeof error.code === "string" && /^[A-Za-z0-9]{1,10}$/.test(error.code) ? error.code : "unknown";
}

/**
 * A client built with throwOnError(), or a network failure, throws instead of returning `error`. A
 * thrown PostgrestError still has a code we can read, so it goes through the same translation; the
 * original object never escapes, since its message and details can carry row values.
 */
async function invoke(name: RpcName, call: () => PromiseLike<RpcResponse>): Promise<RpcResponse> {
  try {
    return await call();
  } catch (thrown) {
    const error = thrownError(thrown);
    if (error) return { data: null, error };
    throw unexpected(name, "thrown");
  }
}

const textField = (value: object, key: string): string | null => {
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : null;
};

/** Code, message and details of a thrown PostgrestError-like object; null for anything else. */
function thrownError(thrown: unknown): RpcErrorLike | null {
  if (typeof thrown !== "object" || thrown === null) return null;
  const code = textField(thrown, "code");
  return code === null ? null : { code, message: textField(thrown, "message"), details: textField(thrown, "details") };
}

/**
 * Calls one RPC of the registry. Throws AppError for the errors the RPC raises on purpose, and
 * UnexpectedRpcError for everything else (including an answer that does not match its schema).
 */
export function callRpc<N extends RpcName>(db: RpcDb, name: N, args: RpcArgs<N>): Promise<RpcResult<N>>;
// One implementation for every name: the overload above is what ties each name to its own types.
export async function callRpc(db: RpcDb, name: RpcName, args: unknown): Promise<unknown> {
  const spec = RPCS[name];
  const parsedArgs = spec.args.safeParse(args);
  if (!parsedArgs.success) throw unexpected(name, "invalid_args");

  const { data, error } = await invoke(name, () => db.rpc(name, parsedArgs.data));
  if (error) {
    const expected = parseRpcError(error);
    if (expected) throw new AppError(expected.code, expected.message);
    throw unexpected(name, errorCodeOf(error));
  }

  const parsed = spec.result.safeParse(data);
  if (!parsed.success) throw unexpected(name, "invalid_response");
  return parsed.data;
}

/** The same client, with the request id on every RPC (it ends up in audit_log). */
export function withRequestId(db: RpcDb, requestId: string): RpcDb {
  return { rpc: (name, args) => db.rpc(name, args).setHeader("x-request-id", requestId) };
}
