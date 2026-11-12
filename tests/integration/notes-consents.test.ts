import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { listStudentConsents, recordConsent, revokeConsent } from "@/lib/server/repos/consents";
import { addGroupStaff } from "@/lib/server/repos/groups";
import { archiveStudentNote, createStudentNote, listStudentNotes, updateStudentNote } from "@/lib/server/repos/notes";
import { withRequestId } from "@/lib/server/repos/rpc";
import { createGroup, createLoggedInUser, createSchool } from "../factories";
import { auditRows, createLoggedInStudent, createStudent } from "../factories/students";

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const student = await createStudent(school.teacher.client, group.id);
  return { ...school, group, student };
}

const CONSENT = { purpose: "ai_adaptation", textVersion: "2026-11" } as const;

describe("repos of notes", () => {
  it("creates, lists, edits and archives a note, and the read leaves its audit row", async () => {
    const { teacher, student } = await setup();
    const opKey = randomUUID();
    const created = await createStudentNote(teacher.client, student.id, {
      body: "  Se distrae con el ruido.  ",
      opKey,
    });
    expect(created.revision).toBe(1);
    // A retry with the same key never writes the note twice.
    const retry = { body: "Se distrae con el ruido.", opKey };
    expect(await createStudentNote(teacher.client, student.id, retry)).toEqual(created);
    const other = { body: "Otra cosa", opKey };
    await expect(createStudentNote(teacher.client, student.id, other)).rejects.toMatchObject({ code: "CONFLICT" });

    const edited = await updateStudentNote(teacher.client, created.id, {
      revision: 1,
      body: "Se distrae con el ruido del patio.",
    });
    expect(edited.revision).toBe(2);
    await expect(updateStudentNote(teacher.client, created.id, { revision: 1, body: "Vieja" })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const requestId = randomUUID();
    const notes = await listStudentNotes(withRequestId(teacher.client, requestId), student.id);
    expect(notes).toEqual([
      expect.objectContaining({
        id: created.id,
        body: "Se distrae con el ruido del patio.",
        authorUserId: teacher.id,
      }),
    ]);
    expect(await auditRows(requestId)).toEqual([
      expect.objectContaining({
        action: "list_student_notes",
        entity_id: student.id,
        student_ids: [student.id],
      }),
    ]);

    const archived = await archiveStudentNote(teacher.client, created.id, 2);
    expect(archived.revision).toBe(3);
    expect((await listStudentNotes(teacher.client, student.id))[0]?.archivedAt).not.toBeNull();
    await expect(updateStudentNote(teacher.client, created.id, { revision: 3, body: "Tarde" })).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("writes no audit row for a student with no notes", async () => {
    const { teacher, student } = await setup();
    const requestId = randomUUID();
    expect(await listStudentNotes(withRequestId(teacher.client, requestId), student.id)).toEqual([]);
    expect(await auditRows(requestId)).toEqual([]);
  });

  it("lets a co-teacher read but not change a note, and denies admin, inclusion and the student", async () => {
    const { admin, institution, teacher, group, student } = await setup();
    const note = await createStudentNote(teacher.client, student.id, {
      body: "Nota privada.",
      opKey: randomUUID(),
    });
    const coTeacher = await createLoggedInUser(admin, institution, "teacher");
    await addGroupStaff(teacher.client, group.id, {
      userId: coTeacher.id,
      role: "co_teacher",
    });
    expect(await listStudentNotes(coTeacher.client, student.id)).toHaveLength(1);
    await expect(updateStudentNote(coTeacher.client, note.id, { revision: 1, body: "X" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(archiveStudentNote(coTeacher.client, note.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const denied = [
      (await createLoggedInUser(admin, institution, "admin")).client,
      (await createLoggedInUser(admin, institution, "inclusion")).client,
      (await createLoggedInStudent(admin, student)).client,
    ];
    for (const client of denied) {
      await expect(listStudentNotes(client, student.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
});

describe("repos of consents", () => {
  it("records, replaces and revokes a consent, and the read leaves its audit row", async () => {
    const { teacher, student } = await setup();
    const first = await recordConsent(teacher.client, student.id, CONSENT);
    expect(await recordConsent(teacher.client, student.id, CONSENT)).toEqual(first);
    const second = await recordConsent(teacher.client, student.id, {
      ...CONSENT,
      textVersion: "2027-03",
    });
    expect(second.id).not.toBe(first.id);

    const requestId = randomUUID();
    const consents = await listStudentConsents(withRequestId(teacher.client, requestId), student.id);
    expect(consents).toHaveLength(2);
    expect(consents.find((c) => c.id === first.id)).toMatchObject({
      status: "revoked",
      revision: 2,
    });
    expect(consents.find((c) => c.id === second.id)).toMatchObject({
      status: "granted",
      textVersion: "2027-03",
    });
    expect(await auditRows(requestId)).toEqual([
      expect.objectContaining({
        action: "list_student_consents",
        student_ids: [student.id],
      }),
    ]);

    const revoked = await revokeConsent(teacher.client, second.id, second.revision);
    expect(revoked.revision).toBe(second.revision + 1);
    await expect(revokeConsent(teacher.client, second.id, revoked.revision)).rejects.toMatchObject({ code: "INVALID" });
  });

  it("rejects a past expiry and a file that does not belong to the student", async () => {
    const { teacher, student } = await setup();
    const past = { ...CONSENT, validUntil: "2020-01-01T00:00:00+00:00" };
    await expect(recordConsent(teacher.client, student.id, past)).rejects.toMatchObject({ code: "INVALID" });
    const file = { ...CONSENT, fileId: randomUUID() };
    await expect(recordConsent(teacher.client, student.id, file)).rejects.toMatchObject({ code: "INVALID" });
  });

  it("lets admin and inclusion read, but only admin and staff record", async () => {
    const { admin, institution, teacher, student } = await setup();
    const boss = await createLoggedInUser(admin, institution, "admin");
    const inclusion = await createLoggedInUser(admin, institution, "inclusion");
    const consent = await recordConsent(boss.client, student.id, {
      purpose: "store_profile",
      textVersion: "2026-11",
    });
    expect(await listStudentConsents(inclusion.client, student.id)).toEqual([
      expect.objectContaining({ id: consent.id }),
    ]);
    await expect(recordConsent(inclusion.client, student.id, CONSENT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeConsent(inclusion.client, consent.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const self = await createLoggedInStudent(admin, student);
    await expect(listStudentConsents(self.client, student.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listStudentConsents(teacher.client, student.id)).toHaveLength(1);
  });
});

describe("isolation of notes and consents between institutions", () => {
  it("answers NOT_FOUND to a user of another institution, leaves no audit row and changes nothing", async () => {
    const { teacher, student } = await setup();
    const note = await createStudentNote(teacher.client, student.id, {
      body: "Privada.",
      opKey: randomUUID(),
    });
    const consent = await recordConsent(teacher.client, student.id, CONSENT);
    const outsider = (await createSchool()).teacher.client;
    const requestId = randomUUID();
    const spy = withRequestId(outsider, requestId);
    const notFound = { code: "NOT_FOUND" };

    await expect(listStudentNotes(spy, student.id)).rejects.toMatchObject(notFound);
    const intruder = { body: "Intruso", opKey: randomUUID() };
    await expect(createStudentNote(spy, student.id, intruder)).rejects.toMatchObject(notFound);
    await expect(updateStudentNote(spy, note.id, { revision: 1, body: "Intruso" })).rejects.toMatchObject(notFound);
    await expect(archiveStudentNote(spy, note.id, 1)).rejects.toMatchObject(notFound);
    await expect(listStudentConsents(spy, student.id)).rejects.toMatchObject(notFound);
    await expect(recordConsent(spy, student.id, { ...CONSENT, textVersion: "x1" })).rejects.toMatchObject(notFound);
    await expect(revokeConsent(spy, consent.id, consent.revision)).rejects.toMatchObject(notFound);

    expect(await auditRows(requestId)).toEqual([]);
    expect(await listStudentNotes(teacher.client, student.id)).toEqual([
      expect.objectContaining({ id: note.id, body: "Privada.", revision: 1 }),
    ]);
    expect(await listStudentConsents(teacher.client, student.id)).toEqual([
      expect.objectContaining({ id: consent.id, status: "granted" }),
    ]);
  });
});
