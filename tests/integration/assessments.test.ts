import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addExercise,
  archiveAssessment,
  createAssessment,
  getAssessment,
  listAssessments,
  removeExercise,
  reorderExercises,
  updateAssessment,
  updateExercise,
} from "@/lib/server/repos/assessments";
import { createGroup, createSchool } from "../factories";
import { createTestAssessment } from "../factories/assessments";

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  return { ...school, group };
}

const NEW = { kind: "exam", topic: "Funciones", generalInstructions: "Elegí dos.", opKey: "" } as const;

describe("repos of assessments", () => {
  it("creates an assessment, and repeating the same opKey answers the same", async () => {
    const { teacher, group } = await setup();
    const input = { ...NEW, opKey: randomUUID() };
    const created = await createAssessment(teacher.client, group.id, input);
    expect(created.revision).toBe(1);
    expect(await createAssessment(teacher.client, group.id, input)).toEqual(created);
    const other = { ...input, topic: "Otro tema" };
    await expect(createAssessment(teacher.client, group.id, other)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await listAssessments(teacher.client, group.id)).total).toBe(1);
  });

  it("reads, lists, updates and archives an assessment", async () => {
    const { teacher, group } = await setup();
    const created = await createAssessment(teacher.client, group.id, { ...NEW, opKey: randomUUID() });
    const detail = await getAssessment(teacher.client, created.id);
    expect(detail.assessment).toMatchObject({ id: created.id, kind: "exam", topic: "Funciones", status: "draft" });
    expect(detail.exercises).toEqual([]);

    const changes = { revision: 1, kind: "worksheet", topic: "Funciones lineales", generalInstructions: "Todo." } as const;
    const updated = await updateAssessment(teacher.client, created.id, changes);
    expect(updated.revision).toBe(2);
    await expect(updateAssessment(teacher.client, created.id, changes)).rejects.toMatchObject({ code: "CONFLICT" });

    const listed = await listAssessments(teacher.client, group.id);
    expect(listed.items).toEqual([expect.objectContaining({ id: created.id, topic: "Funciones lineales", kind: "worksheet" })]);

    const archived = await archiveAssessment(teacher.client, created.id, 2);
    expect(archived.revision).toBe(3);
    expect((await listAssessments(teacher.client, group.id)).items).toEqual([]);
    const all = await listAssessments(teacher.client, group.id, { includeArchived: true });
    expect(all.items).toEqual([expect.objectContaining({ id: created.id, status: "archived" })]);
  });

  it("adds, edits, reorders and removes exercises, and repeating the opKey adds nothing", async () => {
    const { teacher, group } = await setup();
    const { id } = await createTestAssessment(teacher.client, group.id);
    const opKey = randomUUID();
    const first = await addExercise(teacher.client, id, { label: "1", body: "Enunciado 1", opKey });
    expect(await addExercise(teacher.client, id, { label: "1", body: "Enunciado 1", opKey })).toEqual(first);
    const clash = { label: "9", body: "Distinto", opKey };
    await expect(addExercise(teacher.client, id, clash)).rejects.toMatchObject({ code: "CONFLICT" });
    const second = await addExercise(teacher.client, id, { label: "2", body: "Enunciado 2", opKey: randomUUID() });

    const edited = await updateExercise(teacher.client, first.id, { revision: first.revision, label: "1a", body: "Nuevo" });
    expect(edited.revision).toBe(first.revision + 1);
    await expect(
      updateExercise(teacher.client, first.id, { revision: first.revision, label: "1b", body: "Viejo" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const before = await getAssessment(teacher.client, id);
    expect(before.exercises.map((e) => e.id)).toEqual([first.id, second.id]);
    const order = { revision: before.assessment.revision, exerciseIds: [second.id, first.id] };
    await reorderExercises(teacher.client, id, order);
    const after = await getAssessment(teacher.client, id);
    expect(after.exercises.map((e) => [e.id, e.label])).toEqual([
      [second.id, "2"],
      [first.id, "1a"],
    ]);

    const second2 = after.exercises.find((e) => e.id === second.id);
    await removeExercise(teacher.client, second.id, second2?.revision ?? 0);
    expect((await getAssessment(teacher.client, id)).exercises.map((e) => e.id)).toEqual([first.id]);
    expect((await listAssessments(teacher.client, group.id)).items[0]?.exerciseCount).toBe(1);
  });
});

describe("isolation of assessments between institutions", () => {
  it("answers NOT_FOUND to a user of another institution and changes nothing", async () => {
    const { teacher, group } = await setup();
    const { id, exerciseIds } = await createTestAssessment(teacher.client, group.id, 1);
    const outsider = (await createSchool()).teacher.client;
    const notFound = { code: "NOT_FOUND" };
    const [exerciseId = ""] = exerciseIds;

    await expect(getAssessment(outsider, id)).rejects.toMatchObject(notFound);
    await expect(listAssessments(outsider, group.id)).rejects.toMatchObject(notFound);
    await expect(createAssessment(outsider, group.id, { ...NEW, opKey: randomUUID() })).rejects.toMatchObject(notFound);
    const changes = { revision: 1, kind: "exam", topic: "X", generalInstructions: "X" } as const;
    await expect(updateAssessment(outsider, id, changes)).rejects.toMatchObject(notFound);
    await expect(archiveAssessment(outsider, id, 1)).rejects.toMatchObject(notFound);
    const added = { label: "9", body: "Intruso", opKey: randomUUID() };
    await expect(addExercise(outsider, id, added)).rejects.toMatchObject(notFound);
    const edit = { revision: 1, label: "9", body: "X" };
    await expect(updateExercise(outsider, exerciseId, edit)).rejects.toMatchObject(notFound);
    await expect(removeExercise(outsider, exerciseId, 1)).rejects.toMatchObject(notFound);
    const order = { revision: 1, exerciseIds: [exerciseId] };
    await expect(reorderExercises(outsider, id, order)).rejects.toMatchObject(notFound);

    const detail = await getAssessment(teacher.client, id);
    expect(detail.assessment).toMatchObject({ topic: "Repaso", status: "draft" });
    expect(detail.exercises).toEqual([expect.objectContaining({ id: exerciseId, body: "Enunciado 1" })]);
    expect((await listAssessments(teacher.client, group.id)).total).toBe(1);
  });
});
