import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addGroupStaff,
  archiveGroup,
  createGroup,
  getGroup,
  listMyGroups,
  removeGroupStaff,
  restoreGroup,
  updateGroup,
} from "@/lib/server/repos/groups";
import { createLoggedInUser, createSchool } from "../factories";

const NEW_GROUP = { name: "5to B", subjectId: "math", schoolYear: 2027 };

describe("isolation between institutions", () => {
  it("answers NOT_FOUND to a user of another institution in every read and write", async () => {
    const mine = await createSchool();
    const theirs = await createSchool();
    const created = await createGroup(mine.teacher.client, { institutionId: mine.institution.id, ...NEW_GROUP, opKey: randomUUID() });
    const { id, revision } = created;
    const outsider = theirs.teacher.client;
    const notFound = { code: "NOT_FOUND" };

    await expect(getGroup(outsider, id)).rejects.toMatchObject(notFound);
    await expect(listMyGroups(outsider, mine.institution.id)).rejects.toMatchObject(notFound);
    const intruder = { institutionId: mine.institution.id, ...NEW_GROUP, opKey: randomUUID() };
    await expect(createGroup(outsider, intruder)).rejects.toMatchObject(notFound);
    const changes = { revision, name: "X", schoolYear: 2027 };
    await expect(updateGroup(outsider, id, changes)).rejects.toMatchObject(notFound);
    await expect(archiveGroup(outsider, id, revision)).rejects.toMatchObject(notFound);
    await expect(restoreGroup(outsider, id, revision)).rejects.toMatchObject(notFound);
    const staff = { userId: theirs.teacher.id, role: "co_teacher" } as const;
    await expect(addGroupStaff(outsider, id, staff)).rejects.toMatchObject(notFound);
    await expect(removeGroupStaff(outsider, id, mine.teacher.id)).rejects.toMatchObject(notFound);

    // Nothing changed, and the outsider's own institution shows nothing of mine.
    expect(await getGroup(mine.teacher.client, id)).toMatchObject({ name: "5to B", revision });
    expect((await listMyGroups(outsider, theirs.institution.id)).items).toEqual([]);
  });

  it("hides a colleague's group from a teacher, and shows it to the admin with a null role", async () => {
    const { admin, institution, teacher } = await createSchool();
    const colleague = await createLoggedInUser(admin, institution, "teacher");
    const boss = await createLoggedInUser(admin, institution, "admin");
    const { id } = await createGroup(teacher.client, { institutionId: institution.id, ...NEW_GROUP, opKey: randomUUID() });

    expect((await listMyGroups(colleague.client, institution.id)).items).toEqual([]);
    await expect(getGroup(colleague.client, id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const listed = await listMyGroups(boss.client, institution.id);
    expect(listed.items).toEqual([expect.objectContaining({ id, myRole: null })]);
    expect((await getGroup(boss.client, id)).myRole).toBeNull();
  });
});
