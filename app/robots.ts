import type { MetadataRoute } from "next";

// Only the main domain gets indexed. A beta or preview (beta.usetiza.app, a Netlify URL) asks crawlers to stay out,
// so it never competes with usetiza.app in search results. NEXT_PUBLIC_SITE_URL says which one this build is.
const PRODUCTION = "https://usetiza.app";

export default function robots(): MetadataRoute.Robots {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION).replace(/\/$/, "");
  if (site !== PRODUCTION) return { rules: { userAgent: "*", disallow: "/" } };
  // The teacher and student areas need an account: nothing there for a search engine.
  return { rules: { userAgent: "*", allow: "/", disallow: ["/grupos", "/materia", "/estudiante", "/api/", "/demo"] } };
}
