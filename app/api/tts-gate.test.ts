import { beforeEach, describe, expect, it, vi } from "vitest";

// F2-3: /api/tts takes the demo (503: the browser reads with its own voice) or a real actor (getActor() not null); never the
// claims alone, which a closed session still has.

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), list: vi.fn(), readSession: vi.fn(), synthesize: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/lib/server/repos/auth-session", () => ({ getClaims: mocks.getClaims }));
vi.mock("@/lib/server/repos/db", () => ({ sessionDb: async () => ({}) }));
vi.mock("@/lib/server/repos/institutions", () => ({ listMyInstitutions: mocks.list }));
vi.mock("@/app/demo/session", () => ({ readDemoSession: mocks.readSession }));
vi.mock("@/lib/speech/elevenlabs", () => ({
  MAX_TTS_CHARS: 1000,
  synthesize: mocks.synthesize,
  TtsUnavailable: class TtsUnavailable extends Error {},
}));

import { POST as tts } from "./tts/route";

const USER = "11111111-1111-4111-8111-111111111111";
const INSTITUTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const json = (body: unknown) => new Request("http://localhost/api/tts", { method: "POST", body: JSON.stringify(body) });
const noInstitutions = () => mocks.list.mockResolvedValue([]);
const staff = () => mocks.list.mockResolvedValue([{ id: INSTITUTION, name: "Colegio", kind: "school", roles: ["teacher"] }]);
const student = () => mocks.list.mockResolvedValue([{ id: INSTITUTION, name: "Colegio", kind: "school", roles: ["student"] }]);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getClaims.mockResolvedValue({ userId: USER, sessionId: null, email: null });
  mocks.readSession.mockResolvedValue(null);
});
describe("POST /api/tts (quién entra)", () => {
  const speak = () => tts(json({ text: "Hola" }));

  it("sin actor: 401 y no sintetiza", async () => {
    mocks.getClaims.mockResolvedValue(null);
    expect((await speak()).status).toBe(401);
    mocks.getClaims.mockResolvedValue({
      userId: USER,
      sessionId: null,
      email: null,
    });
    noInstitutions();
    expect((await speak()).status).toBe(401);
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it("la demo: 503 (lee el navegador) y no sintetiza", async () => {
    mocks.getClaims.mockResolvedValue(null);
    mocks.readSession.mockResolvedValue({
      demo: true,
      role: "student",
      id: "s",
    });
    expect((await speak()).status).toBe(503);
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  it("un actor real, profe o estudiante, sintetiza", async () => {
    mocks.synthesize.mockResolvedValue(new Uint8Array([1]));
    staff();
    expect((await speak()).status).toBe(200);
    student();
    expect((await speak()).status).toBe(200);
    expect(mocks.synthesize).toHaveBeenCalledTimes(2);
  });
});
