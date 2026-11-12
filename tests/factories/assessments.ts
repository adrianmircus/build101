import { randomUUID } from "node:crypto";
import type { VersionConfig } from "@/lib/domain/assessments/versions";
import { addExercise, createAssessment } from "@/lib/server/repos/assessments";
import type { RpcDb } from "@/lib/server/repos/rpc";
import { createVersion } from "@/lib/server/repos/versions";

// An assessment, its exercises and its versions are always made through the repos, as the
// logged-in teacher, with placeholder text only.

export const CONFIG: VersionConfig = { profiles: ["adhd"], supports: ["recordatorio"], interests: [] };

export async function createTestAssessment(teacher: RpcDb, groupId: string, exercises = 0) {
  const created = await createAssessment(teacher, groupId, {
    kind: "worksheet",
    topic: "Repaso",
    generalInstructions: "Instrucciones",
    opKey: randomUUID(),
  });
  const exerciseIds: string[] = [];
  for (let index = 0; index < exercises; index += 1) {
    const added = await addExercise(teacher, created.id, {
      label: String(index + 1),
      body: `Enunciado ${index + 1}`,
      opKey: randomUUID(),
    });
    exerciseIds.push(added.id);
  }
  return { ...created, exerciseIds };
}

export async function createTestVersion(teacher: RpcDb, assessmentId: string, config: VersionConfig = CONFIG) {
  return createVersion(teacher, assessmentId, { config, answerMode: "typed", opKey: randomUUID() });
}
