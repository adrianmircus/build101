import { z } from "zod";
import { Id, Revision, Timestamp } from "../common";

// Audit log, erasures, presets, notifications and import runs (20261111130800_platform.sql).
// rate_limits and sandbox_sessions have no domain shape: only server code touches them, through
// internal RPCs of phases 2 and 4.

/** One row per disclosure of sensitive data: who, what and to which students. */
export const AuditEntry = z
  .object({
    id: Id,
    actorUserId: Id.nullable(),
    action: z.string().regex(/^[a-z][a-z0-9_.]{2,63}$/),
    entity: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    entityId: Id.nullable(),
    studentIds: z.array(Id),
    requestId: Id.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * What an erasure keeps: the (already unlinked) pseudonym and dates, nothing personal. It is
 * marked before anything is deleted and copied out of the database, so a restore cannot undo it.
 */
export const Erasure = z
  .object({
    id: Id,
    kind: z.enum(["student", "institution"]),
    pseudonymId: Id.nullable(),
    status: z.enum(["marked", "done"]),
    markedAt: Timestamp,
    completedAt: Timestamp.nullable(),
    externalCopiedAt: Timestamp.nullable(),
  })
  .strict();
export type Erasure = z.infer<typeof Erasure>;

export const Preset = z
  .object({
    id: Id,
    name: z.string().trim().min(1).max(120),
    config: z.record(z.string(), z.unknown()),
    archivedAt: Timestamp.nullable(),
    revision: Revision,
  })
  .strict();
export type Preset = z.infer<typeof Preset>;

export const NOTIFICATION_KINDS = ["versions_ready", "task_new", "submission_received"] as const;

/** data holds ids only; the screen resolves names with the reader's own rights. */
export const Notification = z
  .object({
    id: Id,
    kind: z.enum(NOTIFICATION_KINDS),
    entity: z.string(),
    entityId: Id,
    data: z.record(z.string(), z.unknown()),
    readAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type Notification = z.infer<typeof Notification>;

export const ImportRun = z
  .object({
    id: Id,
    formatVersion: z.int().min(1),
    status: z.enum(["running", "done", "failed"]),
    partsTotal: z.int().min(1),
    partsDone: z.int().min(0),
    revision: Revision,
  })
  .strict();
export type ImportRun = z.infer<typeof ImportRun>;
