import { z } from "zod";
import { DateOnly, Id, Revision, Timestamp } from "../common";

// Sensitive: health data (Ley 18.331). Read only through audited RPCs, never shown to the student
// and never sent to the AI with a name or id. Profile and support ids are the validated catalogue:
// a profile exists here only when data/profiles/<id>.md is approved (a test checks it), because
// adaptations come only from that file ("no inventar pedagogía").

export const PROFILE_IDS = ["adhd", "asd", "dysgraphia", "dyslexia", "motor"] as const;
export const ProfileId = z.enum(PROFILE_IDS);
export type ProfileId = z.infer<typeof ProfileId>;

/** Reasoning supports ("razonamiento disminuido"): the only way a version may get easier. */
export const SUPPORT_IDS = ["preguntas_guia", "recordatorio", "ejemplo_resuelto", "numeros_simples"] as const;
export const SupportId = z.enum(SUPPORT_IDS);
export type SupportId = z.infer<typeof SupportId>;

/** Free text the teacher types: it may hold a name, so it is redacted before any AI call. */
export const Interest = z.string().trim().min(1).max(60);

function uniqueList<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .refine((values) => new Set(values).size === values.length, { message: "Hay valores repetidos." });
}

export const NeedsFields = z.object({
  profiles: uniqueList(ProfileId, 10),
  supports: uniqueList(SupportId, 10),
  interests: uniqueList(Interest, 10),
  reviewDueOn: DateOnly.nullable(),
});
export type NeedsFields = z.infer<typeof NeedsFields>;

export const StudentNeeds = NeedsFields.extend({ studentId: Id, revision: Revision }).strict();
export type StudentNeeds = z.infer<typeof StudentNeeds>;

export const NEED_EVENT_KINDS = ["set", "cleared"] as const;

export const StudentNeedEvent = z
  .object({
    id: Id,
    studentId: Id,
    kind: z.enum(NEED_EVENT_KINDS),
    needRevision: Revision,
    before: NeedsFields.nullable(),
    after: NeedsFields,
    actorUserId: Id.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type StudentNeedEvent = z.infer<typeof StudentNeedEvent>;
