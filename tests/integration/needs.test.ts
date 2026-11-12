import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getGroupNeeds,
  getStudentNeeds,
  listStudentNeedEvents,
  setStudentNeeds,
  type NeedsInput,
} from "@/lib/server/repos/needs";
import { withRequestId } from "@/lib/server/repos/rpc";
import { createLoggedInUser, createGroup, createSchool } from "../factories";
import { auditRows, createLoggedInStudent, createStudent } from "../factories/students";

function needs(overrides: Partial<NeedsInput> = {}): NeedsInput {
  return {
    profiles: ["adhd"],
    supports: ["preguntas_guia"],
    interests: ["fútbol"],
    opId: randomUUID(),
    ...overrides,
  };
}

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const student = await createStudent(school.teacher.client, group.id);
  return { ...school, group, student };
}

describe("repos of needs", () => {
  it("sets, reads and lists the history, and every read leaves its audit row", async () => {
    const { teacher, group, student } = await setup();
    const first = needs({ reviewDueOn: "2027-06-01" });
    expect(await setStudentNeeds(teacher.client, student.id, first)).toEqual({
      studentId: student.id,
      revision: 1,
    });
    // The same operation again answers the same result and does not write twice.
    expect(await setStudentNeeds(teacher.client, student.id, first)).toEqual({
      studentId: student.id,
      revision: 1,
    });
    const second = needs({
      revision: 1,
      profiles: ["adhd", "dyslexia"],
      supports: [],
      interests: [],
    });
    expect((await setStudentNeeds(teacher.client, student.id, second)).revision).toBe(2);

    const forStudents = randomUUID();
    const items = await getStudentNeeds(withRequestId(teacher.client, forStudents), [student.id]);
    expect(items).toEqual([
      expect.objectContaining({
        studentId: student.id,
        revision: 2,
        profiles: ["adhd", "dyslexia"],
        reviewDueOn: null,
      }),
    ]);
    expect(await auditRows(forStudents)).toEqual([
      expect.objectContaining({
        action: "get_student_needs",
        student_ids: [student.id],
      }),
    ]);

    const forGroup = randomUUID();
    expect(await getGroupNeeds(withRequestId(teacher.client, forGroup), group.id)).toHaveLength(1);
    expect(await auditRows(forGroup)).toEqual([
      expect.objectContaining({
        action: "get_group_needs",
        entity_id: group.id,
        student_ids: [student.id],
      }),
    ]);

    const forEvents = randomUUID();
    const events = await listStudentNeedEvents(withRequestId(teacher.client, forEvents), student.id, { limit: 10 });
    expect(events.total).toBe(2);
    expect(events.items.map((event) => event.needRevision)).toEqual([2, 1]);
    expect(events.items[0]?.before).toMatchObject({ profiles: ["adhd"] });
    expect(await auditRows(forEvents)).toEqual([expect.objectContaining({ action: "list_student_need_events" })]);
  });

  it("writes no audit row when a read shows nobody", async () => {
    const { teacher, group, student } = await setup();
    const requestId = randomUUID();
    const db = withRequestId(teacher.client, requestId);
    expect(await getStudentNeeds(db, [student.id])).toEqual([]);
    expect(await getGroupNeeds(db, group.id)).toEqual([]);
    expect(await auditRows(requestId)).toEqual([]);
  });

  it("rejects a stale revision, an unknown profile and a reused operation", async () => {
    const { teacher, student } = await setup();
    await setStudentNeeds(teacher.client, student.id, needs());
    const stale = needs({ revision: 5 });
    await expect(setStudentNeeds(teacher.client, student.id, stale)).rejects.toMatchObject({ code: "CONFLICT" });

    const opId = randomUUID();
    await setStudentNeeds(teacher.client, student.id, needs({ opId, revision: 1, supports: [] }));
    const reused = needs({ opId, revision: 2, supports: ["recordatorio"] });
    await expect(setStudentNeeds(teacher.client, student.id, reused)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets inclusion read, and denies an admin who does not teach and the student", async () => {
    const { admin, institution, teacher, student } = await setup();
    await setStudentNeeds(teacher.client, student.id, needs());
    const inclusion = await createLoggedInUser(admin, institution, "inclusion");
    expect(await getStudentNeeds(inclusion.client, [student.id])).toHaveLength(1);

    const boss = await createLoggedInUser(admin, institution, "admin");
    await expect(getStudentNeeds(boss.client, [student.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    const self = await createLoggedInStudent(admin, student);
    await expect(getStudentNeeds(self.client, [student.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listStudentNeedEvents(self.client, student.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("isolation of needs between institutions", () => {
  it("answers NOT_FOUND to a user of another institution, leaves no audit row and changes nothing", async () => {
    const { teacher, group, student } = await setup();
    await setStudentNeeds(teacher.client, student.id, needs());
    const outsider = (await createSchool()).teacher.client;
    const requestId = randomUUID();
    const spy = withRequestId(outsider, requestId);
    const notFound = { code: "NOT_FOUND" };

    await expect(getStudentNeeds(spy, [student.id])).rejects.toMatchObject(notFound);
    await expect(getGroupNeeds(spy, group.id)).rejects.toMatchObject(notFound);
    await expect(listStudentNeedEvents(spy, student.id)).rejects.toMatchObject(notFound);
    await expect(setStudentNeeds(spy, student.id, needs({ revision: 1, profiles: [] }))).rejects.toMatchObject(
      notFound,
    );

    expect(await auditRows(requestId)).toEqual([]);
    expect(await getStudentNeeds(teacher.client, [student.id])).toEqual([
      expect.objectContaining({ revision: 1, profiles: ["adhd"] }),
    ]);
  });
});
