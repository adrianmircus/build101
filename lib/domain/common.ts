import { z } from "zod";

// Building blocks shared by every entity and RPC schema. They mirror the CHECK constraints of the
// contract migrations (supabase/migrations/2026111113*), so the browser gets the same answer the
// database would give, before a round trip.

// Any 8-4-4-4-12 id: Postgres uuids, not only RFC v4 (fixtures and Auth ids are both valid).
export const Id = z.guid();
export type Id = z.infer<typeof Id>;

export const Revision = z.int().min(1);

/** timestamptz as Postgres serializes it in jsonb ("2026-11-11T13:00:00.123456+00:00"). */
export const Timestamp = z.iso.datetime({ offset: true });
export const DateOnly = z.iso.date();

/** Catalogue keys: profiles, supports, error reasons. Same shape as app.is_key_set. */
export const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** A reason code stored in a row (error_code columns). */
export const ReasonCode = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);

export const DisplayName = z.string().trim().min(1).max(120);

/** The subject is a parameter: an id from app.subjects, never a literal in code. */
export const SubjectId = z.string().regex(/^[a-z][a-z_]{1,30}$/);

export const Limit = z.int().min(1).max(200);
export const Offset = z.int().min(0);

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.int().min(0) }).strict();
}

/** What most writes return: the row and the revision the client must send next time. */
export const Written = z.object({ id: Id, revision: Revision }).strict();
export type Written = z.infer<typeof Written>;

/** Writes without a revision of their own (staff rows, enrollments). */
export const Created = z.object({ id: Id }).strict();

/** A jsonb object whose shape the RPC does not fix (generation inputs, raw AI output). */
export const JsonObject = z.record(z.string(), z.json());

/** Shape of every RPC in the registry: args keyed exactly like the SQL parameters. */
export type RpcSpec = { args: z.ZodType<Record<string, unknown>>; result: z.ZodType };
