import { beforeEach, describe, expect, it, vi } from "vitest";
import { messageFor } from "@/lib/domain/errors/reasons";
import { AppError } from "@/lib/errors";

const db = { rpc: vi.fn() };
const createInstitution = vi.fn();
const createInvitationAsOperator = vi.fn<(input: { tokenHash: string }) => Promise<unknown>>();
vi.mock("../../repos/admin/db", () => ({ adminDb: () => db }));
vi.mock("../../repos/admin/identity", () => ({ createInstitution: (...args: unknown[]) => createInstitution(...args) }));
vi.mock("./invitation-signup", () => ({ createInvitationAsOperator: (input: { tokenHash: string }) => createInvitationAsOperator(input) }));

import { createInstitutionWithAdmin } from "./institution";

const INPUT = { name: "Colegio X", code: "Colegio-X", adminEmail: "Admin@Colegio.uy" };
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  createInstitution.mockResolvedValue({ id: ID });
  createInvitationAsOperator.mockResolvedValue({ id: "i", expiresAt: "2026-12-01T00:00:00Z", revision: 1 });
});

describe("createInstitutionWithAdmin", () => {
  it("creates the school and the admin invitation, and the link carries the token in the fragment", async () => {
    const result = await createInstitutionWithAdmin(INPUT);
    expect(createInstitution).toHaveBeenCalledWith(db, { name: "Colegio X", code: "colegio-x", kind: "school" });
    const sent = createInvitationAsOperator.mock.calls[0]?.[0] ?? { tokenHash: "" };
    expect(sent).toMatchObject({ institutionId: ID, email: "admin@colegio.uy", role: "admin" });
    expect(sent.tokenHash).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(result).toMatchObject({ institutionId: ID, created: true, outcome: "invited", expiresAt: "2026-12-01T00:00:00Z" });
    expect(result.invitationLink).toMatch(/^http:\/\/localhost:3000\/invitacion#[A-Za-z0-9_-]{43}$/);
  });

  it("a pending invitation gives no link and no second institution", async () => {
    createInvitationAsOperator.mockRejectedValue(new AppError("CONFLICT", messageFor("CONFLICT", "invitation_pending")));
    await expect(createInstitutionWithAdmin(INPUT)).resolves.toEqual({
      institutionId: ID,
      invitationLink: null,
      created: false,
      outcome: "already_pending",
      expiresAt: null,
    });
  });

  it("an email that already is admin does nothing", async () => {
    createInvitationAsOperator.mockRejectedValue(new AppError("INVALID", messageFor("INVALID", "already_member")));
    await expect(createInstitutionWithAdmin(INPUT)).resolves.toMatchObject({ outcome: "already_admin", invitationLink: null });
  });

  it("the same code with another name says so in Spanish", async () => {
    createInstitution.mockRejectedValue(new AppError("CONFLICT", messageFor("CONFLICT", "op_key_reused")));
    await expect(createInstitutionWithAdmin(INPUT)).rejects.toThrow(/otro nombre/);
    expect(createInvitationAsOperator).not.toHaveBeenCalled();
  });

  it("other errors pass through and bad input never reaches the database", async () => {
    createInvitationAsOperator.mockRejectedValue(new AppError("NOT_FOUND", "x"));
    await expect(createInstitutionWithAdmin(INPUT)).rejects.toThrow("x");
    await expect(createInstitutionWithAdmin({ ...INPUT, adminEmail: "no" })).rejects.toBeInstanceOf(AppError);
    await expect(createInstitutionWithAdmin({ ...INPUT, code: "a" })).rejects.toBeInstanceOf(AppError);
  });

  it("without a public origin it fails before creating anything", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    await expect(createInstitutionWithAdmin(INPUT)).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(createInstitution).not.toHaveBeenCalled();
  });
});
