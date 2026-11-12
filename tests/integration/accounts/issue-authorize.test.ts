import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutOfTheJar } from "../support/cookie-jar";
import { asTeacher, ip, isAdminCall, ORIGIN, provisioningRow, purgeSchools, required, sandboxScene, scene, watchFetch } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { issueAccessCards, listGroupAccounts } from "@/lib/server/services/student-accounts";
import { signInStudent } from "@/lib/server/services/student-auth";

// Who may issue cards (T2.5b, «Emitir tarjetas», F2C-77, F2C-79): the request is authorized with the session, through
// list_group_accounts, BEFORE anything is done with the secret key. A request that does not correspond ends with no admin call.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(signOutOfTheJar);
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

type Scene = Awaited<ReturnType<typeof scene>>;
const request = (s: Scene, studentIds: string[]) => ({ groupId: s.groupId, studentIds, opKey: randomUUID(), origin: ORIGIN });
const idOf = (s: Scene) => required(s.students[0]).id;
const noAdminCall = (calls: ReturnType<typeof watchFetch>["calls"]) => expect(calls.filter(isAdminCall)).toEqual([]);
const remembered = async (s: Scene) => (await provisioningRow(required(s.students[0]).provisioningId))?.auth_user_id;

describe("issueAccessCards authorizes before it calls anything with the secret key", () => {
  it("a student of another group (of another school) ends in NOT_FOUND with no admin call, and nobody got an account", async () => {
    const mine = await scene(1);
    const other = await scene(1);
    await asTeacher(mine);
    const watch = watchFetch();
    await expect(issueAccessCards(request(mine, [idOf(mine), idOf(other)]))).rejects.toMatchObject({ code: "NOT_FOUND" });
    watch.restore();
    noAdminCall(watch.calls);
    expect(await remembered(other)).toBeNull();
    expect(await remembered(mine)).toBeNull();
  });

  it("a group of another school ends in FORBIDDEN or NOT_FOUND with no admin call", async () => {
    const mine = await scene(1);
    const other = await scene(1);
    await asTeacher(mine);
    const watch = watchFetch();
    const refused = await issueAccessCards(request(other, [idOf(other)])).catch((thrown: unknown) => thrown);
    watch.restore();
    expect(refused).toMatchObject({ code: expect.stringMatching(/^(FORBIDDEN|NOT_FOUND)$/) });
    noAdminCall(watch.calls);
    expect(await remembered(other)).toBeNull();
  });

  it("in a sandbox (the demo) it ends in FORBIDDEN with no admin call, and the list says it cannot issue", async () => {
    const sandbox = await sandboxScene();
    const watch = watchFetch();
    await expect(issueAccessCards({ groupId: sandbox.groupId, studentIds: [sandbox.studentId], opKey: randomUUID(), origin: ORIGIN })).rejects.toMatchObject({ code: "FORBIDDEN" });
    watch.restore();
    noAdminCall(watch.calls);
    expect((await listGroupAccounts(sandbox.groupId)).canIssueCards).toBe(false);
  });

  it("without a session it ends with no admin call", async () => {
    const s = await scene(1);
    signOutOfTheJar();
    const watch = watchFetch();
    await expect(issueAccessCards(request(s, [idOf(s)]))).rejects.toBeDefined();
    watch.restore();
    noAdminCall(watch.calls);
  });

  it("the session of a student cannot issue cards: no admin call", async () => {
    const s = await scene(1);
    const student = required(s.students[0]);
    const card = required((await issueAccessCards(request(s, [student.id]))).cards[0]);
    signOutOfTheJar();
    await signInStudent({ code: s.institution.code, username: student.username, password: card.password, ip: ip() });
    const watch = watchFetch();
    await expect(issueAccessCards(request(s, [student.id]))).rejects.toBeDefined();
    watch.restore();
    noAdminCall(watch.calls);
  });

  it("the teacher of the group can, and the list says so (canIssueCards) with rows that carry no profile", async () => {
    const s = await scene(1);
    const group = await listGroupAccounts(s.groupId);
    expect(group).toMatchObject({ canIssueCards: true, institutionCode: s.institution.code });
    expect(group.items).toEqual([expect.objectContaining({ studentId: idOf(s), accountStatus: "pending", hasSignedIn: false, lastCardAt: null })]);
    expect(Object.keys(required(group.items[0])).sort()).toEqual(["accountStatus", "displayName", "hasSignedIn", "lastCardAt", "studentId", "username"]);
  });
});
