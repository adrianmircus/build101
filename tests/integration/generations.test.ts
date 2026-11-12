import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createGeneration,
  type NewGeneration,
  finishGeneration,
  recordAnswerKeyRevision,
  recordGenerationOutput,
} from "@/lib/server/repos/admin/generations";
import { getAnswerKey } from "@/lib/server/repos/answer-keys";
import { getVersion } from "@/lib/server/repos/versions";
import { createGroup, createSchool } from "../factories";
import { createTestAssessment } from "../factories/assessments";
import { createGazeContent, createGazeVersion, keyContentOf, OPTIONS, startGeneration } from "../factories/generations";

const NEW: Omit<NewGeneration, "opKey"> = {
  kind: "version",
  inputs: { exercises: ["Enunciado"] },
  profilesHash: "b".repeat(64),
  profilesRevision: "r1",
  promptVersion: "p1",
  requiredJobs: 1,
};

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const assessment = await createTestAssessment(school.teacher.client, group.id, 1);
  const version = await createGazeVersion(school.teacher.client, assessment.id);
  return { ...school, group, version };
}

describe("repos of generations (admin)", () => {
  it("creates a generation, and repeating the same opKey answers the same one", async () => {
    const { admin, version } = await setup();
    const input = { ...NEW, opKey: randomUUID() };
    const created = await createGeneration(admin, version.id, input);
    expect(created.created).toBe(true);
    expect(await createGeneration(admin, version.id, input)).toEqual({ id: created.id, created: false });
    const other = { ...input, inputs: { exercises: ["Otro enunciado"] } };
    await expect(createGeneration(admin, version.id, other)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records the text and the questions of an exercise, and a retry answers what was decided", async () => {
    const { teacher, admin, version } = await setup();
    const generation = await startGeneration(admin, version.id);
    const [exercise] = (await getVersion(teacher.client, version.id)).exercises;
    const versionExerciseId = exercise?.id ?? "";
    const output = { body: "Texto adaptado", changes: [{ what: "Frases cortas", why: "Apoyo" }] };
    const text = await recordGenerationOutput(admin, generation.id, { kind: "exercise", output, versionExerciseId });
    expect(text.outcome).toBe("applied");
    const retry = await recordGenerationOutput(admin, generation.id, { kind: "exercise", output, versionExerciseId });
    expect(retry).toEqual(text);

    const questions = { questions: [{ stem: "Pregunta", options: OPTIONS }] };
    const asked = { kind: "gaze_questions", output: questions, versionExerciseId } as const;
    expect((await recordGenerationOutput(admin, generation.id, asked)).outcome).toBe("applied");
    const detail = await getVersion(teacher.client, version.id);
    expect(detail.exercises[0]).toMatchObject({ body: "Texto adaptado", status: "ready" });
    expect(detail.questions).toHaveLength(1);

    const instructions = { kind: "instructions", output: { instructions: "Leé con calma." } } as const;
    expect((await recordGenerationOutput(admin, generation.id, instructions)).outcome).toBe("applied");
  });

  it("finishes a generation once: closing again changes nothing", async () => {
    const { teacher, admin, version } = await setup();
    const generation = await startGeneration(admin, version.id);
    const done = await finishGeneration(admin, generation.id, { status: "done" });
    expect(done).toEqual({ id: generation.id, status: "done", changed: true });
    expect(await finishGeneration(admin, generation.id, { status: "done" })).toEqual({ ...done, changed: false });
    const failed = await startGeneration(admin, version.id);
    const closed = await finishGeneration(admin, failed.id, { status: "failed", errorCode: "ai_unavailable" });
    expect(closed.status).toBe("failed");
    expect((await getVersion(teacher.client, version.id)).version.status).not.toBe("generating");
  });

  it("records a generated answer key, and a retry answers the same revision", async () => {
    const { teacher, admin, group, ...school } = await setup();
    const content = await createGazeContent({ ...school, teacher, admin }, group.id);
    const generation = await startGeneration(admin, content.versionId, "answer_key");
    const key = keyContentOf(content, "Generada");
    const written = await recordAnswerKeyRevision(admin, generation.id, key);
    expect(written).toMatchObject({ number: 1, outcome: "applied" });
    expect(await recordAnswerKeyRevision(admin, generation.id, key)).toEqual(written);
    const current = (await getAnswerKey(teacher.client, content.versionId)).current;
    expect(current).toMatchObject({ id: written.revisionId, source: "generated", content: key });
    expect((await finishGeneration(admin, generation.id, { status: "done" })).changed).toBe(true);
  });

  it("is not callable with a teacher session", async () => {
    const { teacher, version } = await setup();
    const input = { ...NEW, opKey: randomUUID() };
    await expect(createGeneration(teacher.client, version.id, input)).rejects.toMatchObject({ name: "UnexpectedRpcError" });
  });
});
