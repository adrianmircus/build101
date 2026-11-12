import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Next logs every Server Function call with its arguments in development: they carry passwords, emails and tokens
  // (docs/contratos/fase-2.md, «Correo»: nothing of that in any log).
  logging: { serverFunctions: false },
  partialPrefetching: true,
  // The agent reads each profile's data at runtime: ship it with the route on deploy.
  outputFileTracingIncludes: {
    // Only the approved .md files: the source PDFs in data/profiles/<id>/sources/ stay out of the function.
    "/api/generate": ["./data/profiles/*.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
