import { z } from "zod";
import { Id, Revision, SubjectId, Timestamp } from "../common";

// Groups, their staff and syllabus (supabase/migrations/20261111130200 and 130300).

export const GroupName = z.string().trim().min(1).max(120);
export const SchoolYear = z.int().min(2020).max(2100);

export const STAFF_ROLES = ["owner", "co_teacher"] as const;
export const StaffRole = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRole>;

export const Group = z.object({
  id: Id,
  institutionId: Id,
  subjectId: SubjectId,
  name: GroupName,
  schoolYear: SchoolYear,
  archivedAt: Timestamp.nullable(),
  revision: Revision,
});
export type Group = z.infer<typeof Group>;

export const GroupStaff = z.object({
  id: Id,
  groupId: Id,
  userId: Id,
  role: StaffRole,
  removedAt: Timestamp.nullable(),
});
export type GroupStaff = z.infer<typeof GroupStaff>;

/** A unit of the syllabus: the topic exercises point to (assessment_exercises.topic_id). */
export const SyllabusUnit = z.object({
  id: Id,
  title: z.string().trim().min(1).max(200),
  contents: z.string().max(5000),
});

export const Syllabus = z.object({
  id: Id,
  groupId: Id,
  units: z.array(SyllabusUnit).max(100),
  fileId: Id.nullable(),
  revision: Revision,
});
export type Syllabus = z.infer<typeof Syllabus>;
