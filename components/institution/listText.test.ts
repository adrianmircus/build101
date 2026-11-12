import { describe, expect, it } from "vitest";
import type { InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import { countText, invitationLine, mailPending, rolesText, staffLine, waitingInvitations } from "./listText";

const BASE: InvitationView = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "pablo@sanjose.edu.uy",
  role: "teacher",
  status: "pending",
  expiresAt: "2026-11-18T15:00:00Z",
  sentAt: "2026-11-11T15:00:00Z",
  invitedByName: null,
  createdAt: "2026-11-11T15:00:00Z",
  revision: 1,
};

describe("invitaciones", () => {
  it("solo esperan respuesta las pendientes y las vencidas", () => {
    const items = (["pending", "expired", "accepted", "revoked"] as const).map((status) => ({ ...BASE, status }));
    expect(waitingInvitations(items).map((item) => item.status)).toEqual(["pending", "expired"]);
  });

  it("dice el rol y el vencimiento en pasado o en futuro", () => {
    expect(invitationLine(BASE)).toBe("Profe · vence el miércoles 18 de noviembre");
    expect(invitationLine({ ...BASE, status: "expired", role: "admin" })).toBe("Admin · venció el miércoles 18 de noviembre");
  });

  it("avisa cuando el correo todavía no salió", () => {
    expect(mailPending({ ...BASE, sentAt: null })).toBe(true);
    expect(mailPending(BASE)).toBe(false);
    expect(mailPending({ ...BASE, sentAt: null, status: "expired" })).toBe(false);
  });
});

describe("profes", () => {
  const ROW: StaffRow = { userId: "22222222-2222-4222-8222-222222222222", displayName: "Diego Núñez", email: "d@x.uy", roles: ["admin", "teacher"], hasSignedIn: false };

  it("junta los roles y dice si ya entró", () => {
    expect(rolesText(ROW.roles)).toBe("Admin y Profe");
    expect(staffLine(ROW, false)).toBe("Admin y Profe · todavía no entró");
    expect(staffLine({ ...ROW, hasSignedIn: true }, false)).toBe("Admin y Profe · ya entró alguna vez");
    expect(staffLine(ROW, true)).toBe("Admin y Profe · vos");
  });
});

describe("countText", () => {
  it("singular y plural", () => {
    expect(countText(1, "profe", "profes")).toBe("1 profe");
    expect(countText(0, "profe", "profes")).toBe("0 profes");
    expect(countText(4, "profe", "profes")).toBe("4 profes");
  });
});
