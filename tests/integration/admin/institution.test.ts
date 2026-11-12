import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/server/auth/tokens";
import { createInstitutionWithAdmin } from "@/lib/server/services/admin/institution";
import { countRows, readRows } from "../support/db";

// The administration command (T2.2) against the real database: the institution and the invitation of its first admin, the
// repetition that creates nothing new, the token in the fragment, and no trace of the link in anything logged.

const lines: string[] = [];
const codes: string[] = [];
const code = () => {
  const value = `t22-${randomUUID().slice(0, 8)}`;
  codes.push(value);
  return value;
};
const address = () => `${randomUUID()}@tiza-test.example`;
const institutionsWith = (value: string) => countRows("select count(*) as n from app.institutions where code = $1", [value]);
const invitationsOf = (institutionId: string) => countRows("select count(*) as n from app.invitations where institution_id = $1 and role = 'admin'", [institutionId]);

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const value of codes) await readRows("delete from app.institutions where code = $1", [value]);
}, 60_000);

describe("createInstitutionWithAdmin", () => {
  it("creates the school and the invitation of the admin, with the token in the fragment of the link", async () => {
    const schoolCode = code();
    const email = address();
    const result = await createInstitutionWithAdmin({ name: "Colegio de prueba", code: schoolCode, adminEmail: email });

    expect(result).toMatchObject({ created: true, outcome: "invited" });
    expect(await institutionsWith(schoolCode)).toBe(1);
    expect(await invitationsOf(result.institutionId)).toBe(1);

    const link = new URL(result.invitationLink ?? "");
    expect(link.origin + link.pathname).toBe("http://localhost:3000/invitacion");
    expect(link.search).toBe("");
    expect(link.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
    // The database holds the hash of that token and nothing else of it, for that email and that role.
    const rows = await readRows<{ same: boolean; email: string; role: string; status: string }>(
      "select token_hash = decode($2, 'hex') as same, email, role, status from app.invitations where institution_id = $1",
      [result.institutionId, hashToken(link.hash.slice(1)).slice(2)],
    );
    expect(rows).toEqual([{ same: true, email, role: "admin", status: "pending" }]);
  });

  it("repeating it with the same code makes no second institution and no second invitation", async () => {
    const schoolCode = code();
    const email = address();
    const first = await createInstitutionWithAdmin({ name: "Colegio repetido", code: schoolCode, adminEmail: email });
    const again = await createInstitutionWithAdmin({ name: "Colegio repetido", code: schoolCode.toUpperCase(), adminEmail: email });

    expect(again).toMatchObject({ institutionId: first.institutionId, created: false, outcome: "already_pending", invitationLink: null });
    expect(await institutionsWith(schoolCode)).toBe(1);
    expect(await invitationsOf(first.institutionId)).toBe(1);

    // Another admin for the same school is a new invitation on the same institution.
    const other = await createInstitutionWithAdmin({ name: "Colegio repetido", code: schoolCode, adminEmail: address() });
    expect(other).toMatchObject({ institutionId: first.institutionId, created: true });
    expect(await institutionsWith(schoolCode)).toBe(1);
    expect(await invitationsOf(first.institutionId)).toBe(2);
  });

  it("the same code with another name is refused in Spanish and creates nothing", async () => {
    const schoolCode = code();
    const first = await createInstitutionWithAdmin({ name: "Uno", code: schoolCode, adminEmail: address() });
    await expect(createInstitutionWithAdmin({ name: "Otro", code: schoolCode, adminEmail: address() })).rejects.toThrow(/otro nombre/);
    expect(await invitationsOf(first.institutionId)).toBe(1);
  });

  it("nothing of the link, the token or the email appears in what was logged", async () => {
    const email = address();
    const result = await createInstitutionWithAdmin({ name: "Colegio silencioso", code: code(), adminEmail: email });
    await createInstitutionWithAdmin({ name: "Colegio silencioso", code: codes.at(-1) ?? "", adminEmail: email });
    const token = (result.invitationLink ?? "").split("#")[1] ?? "";
    expect(token).toHaveLength(43);

    const logged = lines.join("\n");
    for (const secret of [token, hashToken(token), hashToken(token).slice(2), result.invitationLink ?? "", "/invitacion", email]) {
      expect(logged).not.toContain(secret);
    }
  });
});
