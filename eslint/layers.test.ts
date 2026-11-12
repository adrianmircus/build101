import { describe, expect, it } from "vitest";
import { ruleIdsFor, ruleMessages } from "./lint.helper";

const RESTRICTED = "tiza/layers";

// [file that imports, import source, forbidden?]
const cases: Array<[string, string, boolean]> = [
  // components and lib/client never see lib/server
  ["components/a/B.tsx", "@/lib/server/log", true],
  ["components/a/B.tsx", "../../lib/server/log", true],
  ["components/a/B.tsx", "@/lib/client/callAction", false],
  ["lib/client/x.ts", "@/lib/server/entry/run", true],
  ["lib/client/x.ts", "../server/log", true],
  ["lib/client/deep/x.ts", "../../server/log", true],
  ["lib/client/x.ts", "@/lib/errors", false],
  // lib/domain is pure
  ["lib/domain/a.ts", "next/headers", true],
  ["lib/domain/a.ts", "react", true],
  ["lib/domain/a.ts", "react-dom/client", true],
  ["lib/domain/a.ts", "@supabase/supabase-js", true],
  ["lib/domain/a.ts", "@/lib/server/log", true],
  ["lib/domain/a.ts", "../server/log", true],
  ["lib/domain/a.ts", "zod", false],
  ["lib/domain/a.ts", "@/lib/errors", false],
  // db/client.ts: only lib/server/repos/*.ts
  ["lib/server/repos/groups.ts", "@/lib/server/db/client", false],
  ["lib/server/repos/groups.ts", "../db/client", false],
  ["lib/server/repos/admin/x.ts", "@/lib/server/db/client", true],
  ["lib/server/services/x.ts", "@/lib/server/db/client", true],
  ["lib/server/services/x.ts", "../db/client", true],
  ["tests/a.ts", "@/lib/server/db/client", true],
  // db/admin.ts: only repos/admin/** and tests/**
  ["lib/server/repos/admin/x.ts", "@/lib/server/db/admin", false],
  ["tests/a.ts", "@/lib/server/db/admin", false],
  ["tests/a.ts", "../lib/server/db/admin", false],
  ["lib/server/repos/groups.ts", "../db/admin", true],
  ["lib/server/services/x.ts", "@/lib/server/db/admin", true],
  ["lib/server/jobs/x.ts", "@/lib/server/db/admin", true],
  // repos/admin/**: only jobs/** and services/admin/**
  ["lib/server/jobs/x.ts", "@/lib/server/repos/admin/purge", false],
  ["lib/server/services/admin/x.ts", "../../repos/admin/purge", false],
  ["lib/server/services/groups.ts", "@/lib/server/repos/admin/purge", true],
  ["lib/server/repos/groups.ts", "./admin/purge", true],
  ["app/x/actions.ts", "@/lib/server/repos/admin/purge", true],
  ["tests/a.ts", "@/lib/server/repos/admin/purge", false],
  // app/** goes through services
  ["app/x/page.tsx", "@/lib/server/repos/groups", true],
  ["app/x/page.tsx", "../../lib/server/repos/groups", true],
  ["app/x/page.tsx", "@/lib/server/db/client", true],
  ["app/x/page.tsx", "@/lib/server/services/groups", false],
  ["app/x/page.tsx", "next/navigation", false],
];

describe("dependency rules between layers", () => {
  it.each(cases)("%s importing %s (forbidden: %s)", async (file, source, forbidden) => {
    const ids = await ruleIdsFor(`import { x } from "${source}";\nexport const y = x;\n`, file);
    expect(ids.includes(RESTRICTED)).toBe(forbidden);
  });

  it("also covers re-exports", async () => {
    const ids = await ruleIdsFor('export { x } from "@/lib/server/log";\n', "components/a/B.tsx");
    expect(ids).toContain(RESTRICTED);
  });
});

describe("layer rules cannot be sidestepped", () => {
  const lint = (code: string, file: string) => ruleIdsFor(code, file);

  it("flags a barrel that re-exports db/client", async () => {
    expect(await lint('export * from "./client";\n', "lib/server/db/index.ts")).toContain(RESTRICTED);
    expect(await lint('export { db } from "./client";\n', "lib/server/db/index.ts")).toContain(RESTRICTED);
  });
  it("accepts the barrel for what is not restricted", async () => {
    expect(await lint('import { x } from "@/lib/server/db";\nexport const y = x;\n', "lib/server/services/a.ts")).not.toContain(RESTRICTED);
  });
  it("flags a dynamic import()", async () => {
    expect(await lint('export const m = () => import("@/lib/server/log");\n', "components/a/B.tsx")).toContain(RESTRICTED);
    expect(await lint('export const m = () => import("@/lib/client/x");\n', "components/a/B.tsx")).not.toContain(RESTRICTED);
  });
  it("sees through odd spellings of a path", async () => {
    const code = 'import { x } from "../../lib/./server/log";\nexport const y = x;\n';
    expect(await lint(code, "components/a/B.tsx")).toContain(RESTRICTED);
    const up = 'import { x } from "../../components/../lib/server/log";\nexport const y = x;\n';
    expect(await lint(up, "components/a/B.tsx")).toContain(RESTRICTED);
  });
  it("applies ./admin only to lib/server/repos/*.ts", async () => {
    const code = 'import { x } from "./admin";\nexport const y = x;\n';
    expect(await lint(code, "components/x/Page.tsx")).not.toContain(RESTRICTED);
    expect(await lint(code, "lib/server/repos/groups.ts")).toContain(RESTRICTED);
  });
  it("reports the right message", async () => {
    const messages = await ruleMessages('import { x } from "./admin";\nexport const y = x;\n', "lib/server/repos/groups.ts");
    expect(messages.some((m) => m.includes("repos/admin"))).toBe(true);
  });
});
