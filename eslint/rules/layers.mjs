// Dependency rules between layers (docs/PLATAFORMA.md, "Capas"). The rule resolves each specifier
// to the real file and judges importer and target by path, so aliases, relative paths, "./x/../y"
// spellings, re-exports and dynamic import() all get the same verdict. A barrel such as
// lib/server/db/index.ts cannot hide db/client.ts either: its own `export * from "./client"` is an
// import of db/client.ts from a file that is not in lib/server/repos/*.ts.
import { dirname } from "node:path/posix";
import { importVisitors, repoPath, resolveSource, within } from "./imports.mjs";

const DOMAIN_PACKAGES = /^(?:next|react|react-dom)(?:\/|$)|^@supabase\//;

const adminOnly = "lib/server/repos/admin/** only goes into lib/server/jobs/** and lib/server/services/admin/**.";

// Each check returns a message when the import is forbidden, otherwise undefined.
const checks = [
  ({ file, target }) =>
    (within(file, "components") || within(file, "lib/client")) && within(target ?? "", "lib/server")
      ? "This layer cannot import lib/server/**. Call a Server Action or a route instead."
      : undefined,
  ({ file, target, source }) =>
    within(file, "lib/domain") && (within(target ?? "", "lib/server") || DOMAIN_PACKAGES.test(source))
      ? "lib/domain is pure: no Next, React, Supabase or lib/server."
      : undefined,
  ({ file, target }) =>
    target === "lib/server/db/client" && !(dirname(file) === "lib/server/repos")
      ? "lib/server/db/client.ts only goes into lib/server/repos/*.ts."
      : undefined,
  ({ file, target }) =>
    target === "lib/server/db/admin" && !(within(file, "lib/server/repos/admin") || within(file, "tests"))
      ? "lib/server/db/admin.ts only goes into lib/server/repos/admin/** and tests/**."
      : undefined,
  ({ file, target }) =>
    within(target ?? "", "lib/server/repos/admin") &&
    !["lib/server/repos/admin", "lib/server/jobs", "lib/server/services/admin"].some((root) => within(file, root))
      ? adminOnly
      : undefined,
  ({ file, target }) =>
    within(file, "app") && (within(target ?? "", "lib/server/repos") || within(target ?? "", "lib/server/db"))
      ? "app/** goes through lib/server/services, never repos or the database."
      : undefined,
];

export const layers = {
  meta: { type: "problem", schema: [], messages: { forbidden: "{{message}}" } },
  create(context) {
    const file = repoPath(context.filename, context.cwd);
    return importVisitors((node, source) => {
      const target = resolveSource(source, context.filename, context.cwd);
      for (const check of checks) {
        const message = check({ file, target, source });
        if (message !== undefined) context.report({ node, messageId: "forbidden", data: { message } });
      }
    });
  },
};
