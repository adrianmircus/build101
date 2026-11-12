import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { countRows, purgeSchools, scene } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

// The answer of create_student is lost AFTER the database committed: the real repo runs and then the call throws, as a dropped
// connection would (F2-13). The service must say `uncertain` (not `failed`), and the retry with the same opKey and the same `slot`
// must answer the student that already exists. The other half, that the screen really sends that same opKey and slot, is in
// components/institution/createSteps.test.ts (the reducer is legacy code and cannot be imported from here).
const lost = vi.hoisted(() => ({ next: false }));
vi.mock("@/lib/server/repos/students", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/repos/students")>();
  return {
    ...actual,
    createStudent: async (...args: Parameters<typeof actual.createStudent>) => {
      const written = await actual.createStudent(...args);
      if (lost.next) {
        lost.next = false;
        throw new Error("se cortó la conexión");
      }
      return written;
    },
  };
});

import { createStudentAccounts } from "@/lib/server/services/student-accounts";

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
afterAll(purgeSchools, 60_000);

const unique = () => randomUUID().replaceAll("-", "").slice(0, 8);
const enrolled = (groupId: string) => countRows("select count(*)::text as n from app.enrollments where group_id = $1", [groupId]);

describe("una respuesta perdida al crear un estudiante", () => {
  it("es uncertain, y reintentar con el mismo opKey y el mismo slot devuelve al estudiante ya creado (sin username_taken ni duplicado)", async () => {
    const s = await scene(0);
    const opKey = randomUUID();
    const ana = { displayName: "Ana Prueba", username: `ana${unique()}`, slot: 0 };
    const beto = { displayName: "Beto Prueba", username: `beto${unique()}`, slot: 1 };

    // Ana is created; the answer of Beto is lost after the commit.
    lost.next = false;
    await createStudentAccounts({ groupId: s.groupId, opKey, rows: [ana] });
    lost.next = true;
    const first = await createStudentAccounts({ groupId: s.groupId, opKey, rows: [beto] });
    expect(first).toEqual([{ index: 0, outcome: "uncertain", studentId: null }]);
    expect(await enrolled(s.groupId)).toBe(2);

    // The retry sends Beto alone (position 0) but with his own slot: the database answers the student it already has.
    const retry = await createStudentAccounts({ groupId: s.groupId, opKey, rows: [beto] });
    expect(retry).toEqual([{ index: 0, outcome: "created", studentId: expect.any(String) }]);
    expect(await enrolled(s.groupId)).toBe(2);
  });

  it("solo la fila editada es otro estudiante: con otro slot se crea una cuenta nueva", async () => {
    const s = await scene(0);
    const opKey = randomUUID();
    const row = { displayName: "Cami Prueba", username: `cami${unique()}`, slot: 0 };
    lost.next = true;
    expect((await createStudentAccounts({ groupId: s.groupId, opKey, rows: [row] }))[0]?.outcome).toBe("uncertain");
    const edited = await createStudentAccounts({ groupId: s.groupId, opKey, rows: [{ ...row, username: `cami2${unique()}`, slot: 1 }] });
    expect(edited[0]?.outcome).toBe("created");
    expect(await enrolled(s.groupId)).toBe(2);
  });
});
