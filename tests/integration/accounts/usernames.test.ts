import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGroup, createLoggedInUser, createSchool } from "../../factories";
import { createStudent } from "../../factories/students";
import { openSession } from "../support/cookie-jar";
import { countRows, purgeSchools, required, scene } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { createStudentAccounts, previewUsernames } from "@/lib/server/services/student-accounts";

// The «revisar» and «crear» steps of the panel of the institution (T2.5b): the usernames come from the pure rule plus what the
// institution already has, and the creation is one create_student per row with an op_key derived from the one of the request.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
afterAll(purgeSchools, 60_000);

const unique = (prefix: string) => `${prefix}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const FORBIDDEN_OR_NOT_FOUND = { code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/) };

describe("previewUsernames", () => {
  it("suggests the name plus the initial, and counts up past what the institution already has and past the batch itself", async () => {
    const s = await scene(0);
    await createStudent(s.teacher.client, s.groupId, { displayName: "Lucía Fernández", username: "luciaf" });
    await createStudent(s.teacher.client, s.groupId, { displayName: "Lucía Fuentes", username: "luciaf2" });
    const drafts = await previewUsernames({
      institutionId: s.institution.id,
      names: ["Lucía Fiorella", "  Martín Núñez ", "Martín Navarro", "Fernández, Lucía", "Ana"],
    });
    expect(drafts).toEqual([
      { displayName: "Lucía Fiorella", username: "luciaf3" },
      { displayName: "Martín Núñez", username: "martinn" },
      { displayName: "Martín Navarro", username: "martinn2" },
      { displayName: "Fernández, Lucía", username: "luciaf4" },
      { displayName: "Ana", username: "ana" },
    ]);
  });

  it("someone who is not staff of the institution gets an error, not a list", async () => {
    const mine = await scene(0);
    const other = await createSchool();
    await openSession(other.teacher);
    await expect(previewUsernames({ institutionId: mine.institution.id, names: ["Lucía Fernández"] })).rejects.toMatchObject(FORBIDDEN_OR_NOT_FOUND);
  });
});

describe("createStudentAccounts", () => {
  it("makes one student per row, no account in Auth (they stay pending), and repeating the request answers the same students", async () => {
    const s = await scene(0);
    const rows = [
      { displayName: "Ana Prueba", username: unique("a") },
      { displayName: "Beto Prueba", username: unique("b") },
    ];
    const request = { groupId: s.groupId, opKey: randomUUID(), rows };
    const first = await createStudentAccounts(request);
    expect(first).toEqual([
      { index: 0, outcome: "created", studentId: expect.any(String) },
      { index: 1, outcome: "created", studentId: expect.any(String) },
    ]);
    expect(await createStudentAccounts(request)).toEqual(first);

    const ids = first.map((row) => required(row.studentId)).join(",");
    expect(await countRows("select count(*)::text as n from app.students where id = any(string_to_array($1, ',')::uuid[])", [ids])).toBe(2);
    const pending = "select count(*)::text as n from app.account_provisioning where student_id = any(string_to_array($1, ',')::uuid[]) and status = 'pending' and auth_user_id is null";
    expect(await countRows(pending, [ids])).toBe(2);
  });

  it("a row with a username that is taken is `username_taken` and the others go on", async () => {
    const s = await scene(0);
    await createStudent(s.teacher.client, s.groupId, { displayName: "Ya Existe", username: "yaexiste" });
    const results = await createStudentAccounts({
      groupId: s.groupId,
      opKey: randomUUID(),
      rows: [
        { displayName: "Otra Persona", username: "yaexiste" },
        { displayName: "Nueva Persona", username: unique("n") },
      ],
    });
    expect(results).toEqual([
      { index: 0, outcome: "username_taken", studentId: null },
      { index: 1, outcome: "created", studentId: expect.any(String) },
    ]);
  });

  it("without permission over the group it fails as a whole (FORBIDDEN or NOT_FOUND), it does not report each row as failed", async () => {
    const mine = await scene(0);
    const other = await createSchool();
    const outsider = await createLoggedInUser(other.admin, other.institution, "teacher");
    await createGroup(other.teacher.client, other.institution.id);
    await openSession(outsider);
    const rows = [{ displayName: "Ana Prueba", username: unique("x") }];
    await expect(createStudentAccounts({ groupId: mine.groupId, opKey: randomUUID(), rows })).rejects.toMatchObject(FORBIDDEN_OR_NOT_FOUND);
  });
});
