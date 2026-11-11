// Dependency rules between layers (docs/PLATAFORMA.md, "Capas"). no-restricted-imports replaces its
// options instead of merging them, so every zone lists its full set of restrictions. Each path is
// covered in its alias form ("@/lib/...") and in its relative form ("../server/...").

const ups = (path) => [1, 2, 3, 4, 5].map((n) => `${"../".repeat(n)}${path}`);
const both = (path) => [path, `${path}/**`];

const SERVER = [...both("@/lib/server"), ...both("**/lib/server"), ...ups("server").flatMap(both)];
const DB_CLIENT = ["@/lib/server/db/client", "**/db/client", "**/db/client.*"];
const DB_ADMIN = ["@/lib/server/db/admin", "**/db/admin", "**/db/admin.*"];
const DB_ALL = [...both("@/lib/server/db"), ...both("**/server/db"), ...ups("db").flatMap(both)];
const REPOS_ADMIN = [...both("@/lib/server/repos/admin"), ...both("**/repos/admin"), ...both("./admin")];
const REPOS_ALL = [...both("@/lib/server/repos"), ...both("**/server/repos"), ...ups("repos").flatMap(both)];
const DOMAIN_PACKAGES = ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*", "@supabase/*"];

const restrict = (...groups) => ({
  "no-restricted-imports": ["error", { patterns: groups.map(([group, message]) => ({ group, message })) }],
});

const dbClient = [DB_CLIENT, "lib/server/db/client.ts only goes into lib/server/repos/*.ts."];
const dbAdmin = [DB_ADMIN, "lib/server/db/admin.ts only goes into lib/server/repos/admin/** and tests/**."];
const reposAdmin = [
  REPOS_ADMIN,
  "lib/server/repos/admin/** only goes into lib/server/jobs/** and lib/server/services/admin/**.",
];
const noServer = [SERVER, "This layer cannot import lib/server/**. Call a Server Action or a route instead."];
const pureDomain = [SERVER, "lib/domain is pure: no Next, React, Supabase or lib/server."];
const domainPackages = [DOMAIN_PACKAGES, "lib/domain is pure: no Next, React, Supabase or lib/server."];
const appRepos = [REPOS_ALL, "app/** goes through lib/server/services, never repos or the database."];
const appDb = [DB_ALL, "app/** goes through lib/server/services, never repos or the database."];

export const layers = [
  { files: ["**/*.{ts,tsx}"], rules: restrict(dbClient, dbAdmin, reposAdmin) },
  { files: ["lib/server/repos/*.ts"], rules: restrict(dbAdmin, reposAdmin) },
  { files: ["lib/server/repos/admin/**/*.ts"], rules: restrict(dbClient) },
  { files: ["tests/**/*.ts"], rules: restrict(dbClient, reposAdmin) },
  {
    files: ["lib/server/jobs/**/*.ts", "lib/server/services/admin/**/*.ts"],
    rules: restrict(dbClient, dbAdmin),
  },
  {
    files: ["components/**/*.{ts,tsx}", "lib/client/**/*.{ts,tsx}"],
    rules: restrict(dbClient, dbAdmin, reposAdmin, noServer),
  },
  {
    files: ["lib/domain/**/*.ts"],
    rules: restrict(dbClient, dbAdmin, reposAdmin, pureDomain, domainPackages),
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: restrict(dbClient, dbAdmin, reposAdmin, appRepos, appDb),
  },
];
