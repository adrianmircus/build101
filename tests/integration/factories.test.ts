import { describe, expect, it } from "vitest";
import { callRpc } from "@/lib/server/repos/rpc";
import { createGroup, createSchool } from "../factories";

describe("test factories", () => {
  it("makes a teacher who sees their own institution", async () => {
    const { institution, teacher } = await createSchool();
    const { items } = await callRpc(teacher.client, "list_my_institutions", {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: institution.id, kind: "school", roles: ["teacher"] });
  });

  it("lets that teacher create a group in it", async () => {
    const { institution, teacher } = await createSchool();
    const group = await createGroup(teacher.client, institution.id);
    expect(group.revision).toBe(1);
    expect(group.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps two institutions apart", async () => {
    const first = await createSchool();
    const second = await createSchool();
    expect(first.institution.code).not.toBe(second.institution.code);

    const { items } = await callRpc(second.teacher.client, "list_my_institutions", {});
    expect(items.map((item) => item.id)).toEqual([second.institution.id]);

    // The other teacher cannot even tell that the first institution exists.
    await expect(createGroup(second.teacher.client, first.institution.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
