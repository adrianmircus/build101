import { describe, expect, it } from "vitest";
import * as identity from "@/lib/server/repos/admin/identity";
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
import { listMyInstitutions } from "@/lib/server/repos/institutions";
import { createLoggedInUser, createSchool, uniqueCode } from "../factories";

const NEW_GROUP = { name: "4to A", subjectId: "math", schoolYear: 2027 };

describe("repos of institutions and groups", () => {
  it("lists my institutions", async () => {
    const { institution, teacher } = await createSchool();
    const items = await listMyInstitutions(teacher.client);
    expect(items).toEqual([expect.objectContaining({ id: institution.id, roles: ["teacher"] })]);
  });

  it("creates, reads, updates, archives and restores a group", async () => {
    const { institution, teacher } = await createSchool();
    const created = await createGroup(teacher.client, { institutionId: institution.id, ...NEW_GROUP });
    expect(created.revision).toBe(1);

    const detail = await getGroup(teacher.client, created.id);
    expect(detail).toMatchObject({ name: "4to A", institutionId: institution.id, myRole: "owner" });
    expect(detail.staff).toEqual([expect.objectContaining({ userId: teacher.id, role: "owner" })]);

    const updated = await updateGroup(teacher.client, created.id, { revision: 1, name: "4to B", schoolYear: 2028 });
    expect(updated.revision).toBe(2);
    const archived = await archiveGroup(teacher.client, created.id, 2);
    expect(archived.revision).toBe(3);
    expect(await listMyGroups(teacher.client, institution.id)).toMatchObject({ total: 0, items: [] });
    const all = await listMyGroups(teacher.client, institution.id, { includeArchived: true, limit: 10 });
    expect(all.items).toEqual([expect.objectContaining({ id: created.id, name: "4to B", studentCount: 0 })]);

    const restored = await restoreGroup(teacher.client, created.id, 3);
    expect(restored.revision).toBe(4);
    expect((await listMyGroups(teacher.client, institution.id)).total).toBe(1);
  });

  it("rejects a stale revision and a change to an archived group, with Spanish messages", async () => {
    const { institution, teacher } = await createSchool();
    const { id } = await createGroup(teacher.client, { institutionId: institution.id, ...NEW_GROUP });
    const stale = updateGroup(teacher.client, id, { revision: 7, name: "X", schoolYear: 2027 });
    await expect(stale).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Recargá") });

    await archiveGroup(teacher.client, id, 1);
    const archived = updateGroup(teacher.client, id, { revision: 2, name: "X", schoolYear: 2027 });
    await expect(archived).rejects.toMatchObject({ code: "INVALID", message: expect.stringContaining("archivado") });
  });

  it("adds and removes a co-teacher", async () => {
    const { admin, institution, teacher } = await createSchool();
    const other = await createLoggedInUser(admin, institution, "teacher");
    const { id } = await createGroup(teacher.client, { institutionId: institution.id, ...NEW_GROUP });

    const staff = await addGroupStaff(teacher.client, id, { userId: other.id, role: "co_teacher" });
    expect((await getGroup(other.client, id)).myRole).toBe("co_teacher");
    expect(await removeGroupStaff(teacher.client, id, other.id)).toEqual(staff);
    await expect(getGroup(other.client, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates, links and revokes through the internal repos", async () => {
    const { admin, institution, teacher } = await createSchool();
    const code = uniqueCode("r");
    const created = await identity.createInstitution(admin, { name: "Colegio", code, kind: "school" });
    expect(await identity.createInstitution(admin, { name: "Colegio", code, kind: "school" })).toEqual(created);
    const other = { name: "Otro", code, kind: "school" } as const;
    await expect(identity.createInstitution(admin, other)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await identity.upsertAppUser(admin, teacher.id, "Nombre nuevo")).toEqual({ id: teacher.id });
    const membership = await identity.addMembership(admin, {
      institutionId: created.id,
      userId: teacher.id,
      role: "teacher",
    });
    expect(await listMyInstitutions(teacher.client)).toHaveLength(2);
    await identity.revokeMembership(admin, membership.id);
    expect((await listMyInstitutions(teacher.client)).map((i) => i.id)).toEqual([institution.id]);
  });

  it("reports a missing user as NOT_FOUND", async () => {
    const { admin } = await createSchool();
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(identity.upsertAppUser(admin, missing)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
