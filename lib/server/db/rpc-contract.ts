import "server-only";
import type { z } from "zod";
import type { RPCS } from "@/lib/domain/rpc";
import type { Database } from "./types";

// Compile-time link between the domain registry (lib/domain/rpc.ts) and the functions the
// database really has (types.ts, generated). If a migration renames a parameter or adds an RPC
// without its schema, `npm run typecheck` fails here, before any repo is written against it.

type DbFunctions = Database["api"]["Functions"];

/** Names on one side and not on the other. Both must be never. */
export type MissingInRegistry = Exclude<keyof DbFunctions, keyof typeof RPCS>;
export type MissingInDatabase = Exclude<keyof typeof RPCS, keyof DbFunctions>;

// A function without parameters is generated as Args: Record<PropertyKey, never>, and an empty
// strict zod object outputs Record<string, never>: both sides are "no named key".
type NoNamedKeys<T> = string extends keyof T ? true : [keyof T] extends [never] ? true : false;
type SameKeys<A, B> =
  NoNamedKeys<B> extends true
    ? NoNamedKeys<A>
    : [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false;

/**
 * The parsed args name exactly the SQL parameters, and their values are accepted by PostgREST's
 * signature (the domain is narrower: an enum where SQL has text and a CHECK).
 */
type ArgsMatch = {
  [N in keyof typeof RPCS & keyof DbFunctions]: z.output<(typeof RPCS)[N]["args"]> extends DbFunctions[N]["Args"]
    ? SameKeys<z.output<(typeof RPCS)[N]["args"]>, DbFunctions[N]["Args"]>
    : false;
};

type Mismatched = { [N in keyof ArgsMatch]: ArgsMatch[N] extends true ? never : N }[keyof ArgsMatch];

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

// Each line fails to compile, naming the offending RPCs in the error, when the two sides drift.
export type RegistryCoversDatabase = Assert<IsNever<MissingInRegistry>>;
export type DatabaseCoversRegistry = Assert<IsNever<MissingInDatabase>>;
export type ArgumentsMatch = Assert<IsNever<Mismatched>>;
