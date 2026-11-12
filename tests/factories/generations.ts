import { randomUUID } from "node:crypto";
import type { AnswerKeyContent, GenerationKind } from "@/lib/domain/assessments/generations";
import type { VersionConfig } from "@/lib/domain/assessments/versions";
import type { AdminClient } from "@/lib/server/db/admin";
import { createGeneration, finishGeneration, recordGenerationOutput } from "@/lib/server/repos/admin/generations";
import type { RpcDb } from "@/lib/server/repos/rpc";
import { createVersion, getVersion } from "@/lib/server/repos/versions";
import { createTestAssessment } from "./assessments";
import type { School } from "./index";

// What the bridge to the AI would write, made through the internal repos with placeholder text only.

export const OPTIONS = [
  { id: "A", text: "Uno" },
  { id: "B", text: "Dos" },
];

/** A generation of the version, as service_role starts it. */
export async function startGeneration(admin: AdminClient, versionId: string, kind: GenerationKind = "version") {
  return createGeneration(admin, versionId, {
    kind,
    opKey: randomUUID(),
    inputs: { exercises: ["Enunciado"] },
    profilesHash: "a".repeat(64),
    profilesRevision: "r1",
    promptVersion: "p1",
    requiredJobs: 2,
  });
}

/** A version in gaze mode for the motor profile, empty. */
export async function createGazeVersion(teacher: RpcDb, assessmentId: string) {
  const config: VersionConfig = { profiles: ["motor"], supports: [], interests: [] };
  return createVersion(teacher, assessmentId, { config, answerMode: "gaze", opKey: randomUUID() });
}

export type ContentFixture = {
  versionId: string;
  generationId: string;
  /** The adapted exercises, in the order of the original. */
  adapted: string[];
  /** The two questions of the first adapted exercise. */
  questions: string[];
};

/**
 * A gaze version of a new assessment with `exercises` exercises. Its text and two questions in the
 * first exercise are written by one generation, which is finished (done) so the version is ready.
 */
export async function createGazeContent({ teacher: user, admin }: School, groupId: string, exercises = 2) {
  const teacher = user.client;
  const assessment = await createTestAssessment(teacher, groupId, exercises);
  const version = await createGazeVersion(teacher, assessment.id);
  const generation = await startGeneration(admin, version.id);
  const before = await getVersion(teacher, version.id);
  const adapted = before.exercises.map((exercise) => exercise.id);
  for (const id of adapted) {
    const output = { body: "Texto adaptado", changes: [{ what: "Frases cortas", why: "Apoyo de lectura" }] };
    await recordGenerationOutput(admin, generation.id, { kind: "exercise", output, versionExerciseId: id });
  }
  const [first] = adapted;
  if (first === undefined) throw new Error("La versión de prueba no tiene ejercicios.");
  const questions = { questions: [{ stem: "Pregunta 1", options: OPTIONS }, { stem: "Pregunta 2", options: OPTIONS }] };
  await recordGenerationOutput(admin, generation.id, { kind: "gaze_questions", output: questions, versionExerciseId: first });
  await finishGeneration(admin, generation.id, { status: "done" });
  const detail = await getVersion(teacher, version.id);
  const content: ContentFixture = {
    versionId: version.id,
    generationId: generation.id,
    adapted,
    questions: detail.questions.map((question) => question.id),
  };
  return content;
}

/** The key of the fixture: a text answer per adapted exercise and A for each question. */
export function keyContentOf(content: ContentFixture, answer = "Respuesta"): AnswerKeyContent {
  return {
    exercises: Object.fromEntries(content.adapted.map((id) => [id, { answer }])),
    questions: Object.fromEntries(content.questions.map((id) => [id, "A"])),
  };
}
