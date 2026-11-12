import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

// F2-3: every route that calls an AI provider asks the database who is asking BEFORE touching the provider. The real getActor
// runs here over a mocked database: a closed session is the RPC refusing (FORBIDDEN), an account with no institution is an
// empty list. The providers are mocks that must never be called when the answer is not a staff member. The demo is answered 403 by the proxy before the route (proxy.test.ts).

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  list: vi.fn(),
  generateVersion: vi.fn(),
  readExercisesPdf: vi.fn(),
  analyzeResults: vi.fn(),
  extractUnits: vi.fn(),
  transcribeAnswer: vi.fn(),
  interpretCommand: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/lib/server/repos/auth-session", () => ({
  getClaims: mocks.getClaims,
}));
vi.mock("@/lib/server/repos/db", () => ({ sessionDb: async () => ({}) }));
vi.mock("@/lib/server/repos/institutions", () => ({
  listMyInstitutions: mocks.list,
}));
vi.mock("@/lib/agent/generate", () => ({
  generateVersion: mocks.generateVersion,
  AgentError: class AgentError extends Error {},
}));
vi.mock("@/lib/agent/exercises", () => ({
  readExercisesPdf: mocks.readExercisesPdf,
}));
vi.mock("@/lib/agent/analyze", () => ({
  analyzeResults: mocks.analyzeResults,
}));
vi.mock("@/lib/agent/syllabus", () => ({ extractUnits: mocks.extractUnits }));
vi.mock("@/lib/agent/transcribe", () => ({
  transcribeAnswer: mocks.transcribeAnswer,
}));
vi.mock("@/lib/agent/voiceCommand", () => ({
  interpretCommand: mocks.interpretCommand,
}));
vi.mock("@/lib/agent/client", () => ({
  deadline: () => new AbortController().signal,
  cutShort: () => null,
  getClient: () => ({ files: { upload: mocks.upload } }),
}));
import { POST as answersTranscribe } from "./answers/transcribe/route";
import { POST as assessmentsReadPdf } from "./assessments/read-pdf/route";
import { POST as generate } from "./generate/route";
import { POST as resultsAnalyze } from "./results/analyze/route";
import { POST as syllabusPdf } from "./syllabus/pdf/route";
import { POST as syllabusUnits } from "./syllabus/units/route";
import { POST as voiceCommand } from "./voice/command/route";

const USER = "11111111-1111-4111-8111-111111111111";
const INSTITUTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const json = (body: unknown) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    body: JSON.stringify(body),
  });
const form = (file: File) => {
  const data = new FormData();
  data.set("file", file);
  data.set("fileId", "x");
  return new Request("http://localhost/api/x", { method: "POST", body: data });
};
const pdf = () =>
  new File(["%PDF-1.4"], "programa.pdf", { type: "application/pdf" });

type Case = {
  name: string;
  call: () => Promise<Response>;
  provider: () => ReturnType<typeof vi.fn>;
};
const CASES: Case[] = [
  {
    name: "generate",
    call: () =>
      generate(
        json({
          type: "worksheet",
          topic: "Funciones",
          original: "1. Resolver x+1=2",
          profiles: [],
        }),
      ),
    provider: () => mocks.generateVersion,
  },
  {
    name: "assessments/read-pdf",
    call: () => assessmentsReadPdf(form(pdf())),
    provider: () => mocks.readExercisesPdf,
  },
  {
    name: "results/analyze",
    call: () =>
      resultsAnalyze(
        json({
          assessments: [
            {
              type: "exam",
              topic: "Funciones",
              exercises: ["1"],
              students: [{ ref: "E1", marks: [null] }],
            },
          ],
        }),
      ),
    provider: () => mocks.analyzeResults,
  },
  {
    name: "syllabus/pdf",
    call: () => syllabusPdf(form(pdf())),
    provider: () => mocks.upload,
  },
  {
    name: "syllabus/units",
    call: () => syllabusUnits(json({ fileId: "file_1" })),
    provider: () => mocks.extractUnits,
  },
  {
    name: "answers/transcribe",
    call: () =>
      answersTranscribe(json({ exercise: "1", transcript: "equis más uno" })),
    provider: () => mocks.transcribeAnswer,
  },
  {
    name: "voice/command",
    call: () =>
      voiceCommand(
        json({
          heard: "siguiente",
          commands: [{ id: "next", label: "Siguiente" }],
        }),
      ),
    provider: () => mocks.interpretCommand,
  },
];

const noInstitutions = () => mocks.list.mockResolvedValue([]);
const staff = () =>
  mocks.list.mockResolvedValue([
    { id: INSTITUTION, name: "Colegio", kind: "school", roles: ["teacher"] },
  ]);
const student = () =>
  mocks.list.mockResolvedValue([
    { id: INSTITUTION, name: "Colegio", kind: "school", roles: ["student"] },
  ]);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getClaims.mockResolvedValue({
    userId: USER,
    sessionId: null,
    email: null,
  });
  mocks.generateVersion.mockResolvedValue({});
  mocks.readExercisesPdf.mockResolvedValue({ exercises: [] });
  mocks.analyzeResults.mockResolvedValue({});
  mocks.extractUnits.mockResolvedValue([]);
  mocks.transcribeAnswer.mockResolvedValue({});
  mocks.interpretCommand.mockResolvedValue({});
  mocks.upload.mockResolvedValue({ id: "file_1" });
});

describe.each(CASES)("POST /api/$name", ({ call, provider }) => {
  it("sin sesión: 401 y el proveedor nunca se llama", async () => {
    mocks.getClaims.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Tu sesión venció. Volvé a ingresar.",
    });
    expect(provider()).not.toHaveBeenCalled();
  });

  it("una sesión revocada (la base la rechaza): 401 y el proveedor nunca se llama", async () => {
    mocks.list.mockRejectedValue(
      new AppError("FORBIDDEN", "Tu sesión terminó. Volvé a entrar."),
    );
    expect((await call()).status).toBe(401);
    expect(provider()).not.toHaveBeenCalled();
  });

  it("una cuenta sin membresías: 401 y el proveedor nunca se llama", async () => {
    noInstitutions();
    expect((await call()).status).toBe(401);
    expect(provider()).not.toHaveBeenCalled();
  });

  it("un estudiante: 403 y el proveedor nunca se llama", async () => {
    student();
    expect((await call()).status).toBe(403);
    expect(provider()).not.toHaveBeenCalled();
  });

  it("una falla de la base que no es de permisos: 503, sin gastar", async () => {
    mocks.list.mockRejectedValue(new Error("connection refused"));
    expect((await call()).status).toBe(503);
    expect(provider()).not.toHaveBeenCalled();
  });

  it("un profe con la sesión viva llega al proveedor", async () => {
    staff();
    const response = await call();
    expect(response.status).toBe(200);
    expect(provider()).toHaveBeenCalledTimes(1);
  });
});
