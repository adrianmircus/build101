import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VersionConfig } from "@/lib/domain/assessments/versions";
import { withRequestId } from "@/lib/server/repos/rpc";
import {
  archiveVersion,
  createVersion,
  getVersion,
  listVersions,
  setVersionRecipients,
  updateVersionConfig,
} from "@/lib/server/repos/versions";
import { createGroup, createSchool } from "../factories";
import { CONFIG, createTestAssessment, createTestVersion } from "../factories/assessments";
import { auditRows, createStudent } from "../factories/students";

async function setup() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const assessment = await createTestAssessment(school.teacher.client, group.id, 1);
  return { ...school, group, assessment };
}

describe("repos of versions", () => {
  it("creates a version, and repeating the same opKey answers the same", async () => {
    const { teacher, assessment } = await setup();
    const input = { config: CONFIG, answerMode: "typed", opKey: randomUUID() } as const;
    const created = await createVersion(teacher.client, assessment.id, input);
    expect(created).toMatchObject({ revision: 1, position: 1 });
    expect(await createVersion(teacher.client, assessment.id, input)).toEqual(created);
    const other = { ...input, answerMode: "voice" } as const;
    await expect(createVersion(teacher.client, assessment.id, other)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listVersions(teacher.client, assessment.id)).toHaveLength(1);
  });

  it("lists, updates the config and archives a version", async () => {
    const { teacher, assessment } = await setup();
    const version = await createTestVersion(teacher.client, assessment.id);
    expect(await listVersions(teacher.client, assessment.id)).toEqual([
      expect.objectContaining({ id: version.id, position: 1, status: "empty", approved: false }),
    ]);

    const config: VersionConfig = { profiles: ["dyslexia"], supports: [], interests: [] };
    const changes = { revision: 1, config, answerMode: "voice" } as const;
    const updated = await updateVersionConfig(teacher.client, version.id, changes);
    expect(updated.revision).toBe(2);
    await expect(updateVersionConfig(teacher.client, version.id, changes)).rejects.toMatchObject({ code: "CONFLICT" });
    const detail = await getVersion(teacher.client, version.id);
    expect(detail.version).toMatchObject({ config, answerMode: "voice", revision: 2 });

    const archived = await archiveVersion(teacher.client, version.id, 2);
    expect(archived.revision).toBe(3);
    expect((await getVersion(teacher.client, version.id)).version.revision).toBe(3);
  });

  it("sets the recipients, and getVersion leaves its audit row with the request id", async () => {
    const { teacher, group, assessment } = await setup();
    const version = await createTestVersion(teacher.client, assessment.id);
    const student = await createStudent(teacher.client, group.id);
    const opId = randomUUID();
    const set = await setVersionRecipients(teacher.client, version.id, { revision: 1, studentIds: [student.id], opId });
    expect(await setVersionRecipients(teacher.client, version.id, { revision: 1, studentIds: [student.id], opId })).toEqual(set);
    const reuse = { revision: 1, studentIds: [], opId };
    await expect(setVersionRecipients(teacher.client, version.id, reuse)).rejects.toMatchObject({ code: "CONFLICT" });

    const requestId = randomUUID();
    const detail = await getVersion(withRequestId(teacher.client, requestId), version.id);
    expect(detail.recipients).toEqual([expect.objectContaining({ studentId: student.id })]);
    expect(await auditRows(requestId)).toEqual([
      expect.objectContaining({ action: "get_version", entity: "version", entity_id: version.id, student_ids: [student.id] }),
    ]);
  });

  it("writes no audit row for a version without recipients", async () => {
    const { teacher, assessment } = await setup();
    const version = await createTestVersion(teacher.client, assessment.id);
    const requestId = randomUUID();
    await getVersion(withRequestId(teacher.client, requestId), version.id);
    expect(await auditRows(requestId)).toEqual([]);
  });

  it("answers NOT_FOUND to a user of another institution, leaves no audit row and changes nothing", async () => {
    const { teacher, group, assessment } = await setup();
    const version = await createTestVersion(teacher.client, assessment.id);
    const student = await createStudent(teacher.client, group.id);
    await setVersionRecipients(teacher.client, version.id, { revision: 1, studentIds: [student.id], opId: randomUUID() });
    const requestId = randomUUID();
    const spy = withRequestId((await createSchool()).teacher.client, requestId);
    const notFound = { code: "NOT_FOUND" };

    await expect(getVersion(spy, version.id)).rejects.toMatchObject(notFound);
    await expect(listVersions(spy, assessment.id)).rejects.toMatchObject(notFound);
    await expect(createTestVersion(spy, assessment.id)).rejects.toMatchObject(notFound);
    const config = { revision: 1, config: CONFIG, answerMode: "gaze" } as const;
    await expect(updateVersionConfig(spy, version.id, config)).rejects.toMatchObject(notFound);
    const recipients = { revision: 1, studentIds: [], opId: randomUUID() };
    await expect(setVersionRecipients(spy, version.id, recipients)).rejects.toMatchObject(notFound);
    await expect(archiveVersion(spy, version.id, 1)).rejects.toMatchObject(notFound);

    expect(await auditRows(requestId)).toEqual([]);
    const detail = await getVersion(teacher.client, version.id);
    expect(detail.version).toMatchObject({ config: CONFIG, answerMode: "typed", status: "empty" });
    expect(detail.recipients).toHaveLength(1);
    expect(await listVersions(teacher.client, assessment.id)).toHaveLength(1);
  });
});
