import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { linkStudentUser } from "@/lib/server/repos/admin/students";
import {
  archiveStudent,
  createStudent,
  enrollStudent,
  listGroupStudents,
  restoreStudent,
  setStudentInterface,
  unenrollStudent,
  updateStudent,
} from "@/lib/server/repos/students";
import { studentHome } from "@/lib/server/repos/student";
import { setStudentNeeds } from "@/lib/server/repos/needs";
import { createGroup, createSchool } from "../factories";
import { createLoggedInStudent, createStudent as makeStudent } from "../factories/students";

async function schoolWithGroup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  return { ...school, group };
}

describe("repos of students", () => {
  it("creates a student, enrolled, and answers the same one to a retry", async () => {
    const { teacher, group } = await schoolWithGroup();
    const input = {
      displayName: "Ana Prueba",
      username: "ana.prueba",
      opKey: randomUUID(),
    };
    const created = await createStudent(teacher.client, group.id, input);
    expect(created).toMatchObject({
      revision: 1,
      provisioningId: expect.any(String),
    });
    expect(await createStudent(teacher.client, group.id, input)).toEqual(created);

    const listed = await listGroupStudents(teacher.client, group.id);
    expect(listed.items).toEqual([
      expect.objectContaining({
        id: created.id,
        displayName: "Ana Prueba",
        username: "ana.prueba",
        hasAccount: false,
      }),
    ]);
  });

  it("rejects a taken username and a reused key", async () => {
    const { teacher, group } = await schoolWithGroup();
    const first = await makeStudent(teacher.client, group.id);
    const copy = {
      displayName: "Otra",
      username: first.username,
      opKey: randomUUID(),
    };
    await expect(createStudent(teacher.client, group.id, copy)).rejects.toMatchObject({ code: "CONFLICT" });

    const reused = {
      displayName: "X",
      username: "x.distinto",
      opKey: randomUUID(),
    };
    await createStudent(teacher.client, group.id, reused);
    const changed = { ...reused, username: "x.otro" };
    await expect(createStudent(teacher.client, group.id, changed)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("updates, archives and restores a student", async () => {
    const { teacher, group } = await schoolWithGroup();
    const student = await makeStudent(teacher.client, group.id);
    const changes = {
      revision: 1,
      displayName: "Nombre nuevo",
      username: "nuevo.user",
    };
    expect((await updateStudent(teacher.client, student.id, changes)).revision).toBe(2);
    await expect(updateStudent(teacher.client, student.id, changes)).rejects.toMatchObject({ code: "CONFLICT" });

    const archived = await archiveStudent(teacher.client, student.id, 2);
    expect((await listGroupStudents(teacher.client, group.id)).items).toEqual([]);
    const all = await listGroupStudents(teacher.client, group.id, {
      includeArchived: true,
    });
    expect(all.items).toEqual([expect.objectContaining({ id: student.id, displayName: "Nombre nuevo" })]);
    expect(all.items[0]?.archivedAt).not.toBeNull();

    const restored = await restoreStudent(teacher.client, student.id, archived.revision);
    expect(restored.revision).toBe(archived.revision + 1);
    expect((await listGroupStudents(teacher.client, group.id)).total).toBe(1);
  });

  it("sets the accessibility interface of a student, apart from the profile, and the student sees it", async () => {
    const { admin, teacher, group } = await schoolWithGroup();
    const student = await makeStudent(teacher.client, group.id);
    const logged = await createLoggedInStudent(admin, student);
    expect((await studentHome(logged.client)).interface).toBe("standard");

    // A motor profile does not choose the interface (it used to derive gaze).
    await setStudentNeeds(teacher.client, student.id, { profiles: ["motor"], supports: [], interests: [], opId: randomUUID() });
    expect((await studentHome(logged.client)).interface).toBe("standard");

    const set = await setStudentInterface(teacher.client, student.id, { interface: "gaze", revision: 1 });
    expect(set).toEqual({ id: student.id, revision: 2 });
    expect((await studentHome(logged.client)).interface).toBe("gaze");
    // The same value does not move the revision; a stale one is CONFLICT; a value outside the three is refused by the schema.
    expect(await setStudentInterface(teacher.client, student.id, { interface: "gaze", revision: 2 })).toEqual(set);
    await expect(setStudentInterface(teacher.client, student.id, { interface: "voice", revision: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    // Taking motor off the profile does not take gaze off the student.
    await setStudentNeeds(teacher.client, student.id, { profiles: [], supports: [], interests: [], opId: randomUUID(), revision: 1 });
    expect((await studentHome(logged.client)).interface).toBe("gaze");
  });

  it("enrolls a student in a second group and unenrolls them from the first", async () => {
    const { institution, teacher, group } = await schoolWithGroup();
    const other = await createGroup(teacher.client, institution.id, {
      name: "Otro grupo",
    });
    const student = await makeStudent(teacher.client, group.id);

    const enrollment = await enrollStudent(teacher.client, other.id, student.id);
    expect(enrollment.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await listGroupStudents(teacher.client, other.id)).total).toBe(1);

    const ended = await unenrollStudent(teacher.client, group.id, student.id);
    expect((await listGroupStudents(teacher.client, group.id)).items).toEqual([]);
    // A retry finds the enrollment already ended and answers the same one.
    expect(await unenrollStudent(teacher.client, group.id, student.id)).toEqual(ended);
    await expect(unenrollStudent(teacher.client, other.id, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("links an Auth account through the internal repo, and only one", async () => {
    const { admin, teacher, group } = await schoolWithGroup();
    const student = await makeStudent(teacher.client, group.id);
    const logged = await createLoggedInStudent(admin, student);
    expect((await listGroupStudents(teacher.client, group.id)).items[0]).toMatchObject({ hasAccount: true });

    const again = await linkStudentUser(admin, student.id, logged.userId);
    expect(again.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(linkStudentUser(admin, student.id, randomUUID())).rejects.toBeDefined();
  });
});

describe("isolation of students between institutions", () => {
  it("answers NOT_FOUND to a user of another institution and changes nothing", async () => {
    const mine = await schoolWithGroup();
    const theirs = await createSchool();
    const student = await makeStudent(mine.teacher.client, mine.group.id);
    const outsider = theirs.teacher.client;
    const notFound = { code: "NOT_FOUND" };

    const input = {
      displayName: "Intruso",
      username: "intruso.user",
      opKey: randomUUID(),
    };
    await expect(createStudent(outsider, mine.group.id, input)).rejects.toMatchObject(notFound);
    const changes = { revision: 1, displayName: "X", username: "x.user" };
    await expect(updateStudent(outsider, student.id, changes)).rejects.toMatchObject(notFound);
    await expect(archiveStudent(outsider, student.id, 1)).rejects.toMatchObject(notFound);
    await expect(restoreStudent(outsider, student.id, 1)).rejects.toMatchObject(notFound);
    await expect(enrollStudent(outsider, mine.group.id, student.id)).rejects.toMatchObject(notFound);
    await expect(unenrollStudent(outsider, mine.group.id, student.id)).rejects.toMatchObject(notFound);
    await expect(listGroupStudents(outsider, mine.group.id)).rejects.toMatchObject(notFound);

    const listed = await listGroupStudents(mine.teacher.client, mine.group.id);
    expect(listed.items).toEqual([
      expect.objectContaining({
        id: student.id,
        revision: 1,
        archivedAt: null,
      }),
    ]);
  });
});
