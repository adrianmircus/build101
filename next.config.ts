import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
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
