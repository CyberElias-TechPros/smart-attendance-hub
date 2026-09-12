// Generates dist/sitemap.xml with absolute URLs at build time (runs as the
// `postbuild` step). Sitemap <loc> values MUST be absolute, but the
// production domain is only known at deploy time, so it cannot be committed.
//
// Domain resolution (first hit wins):
//   1. SITE_URL env var (e.g. https://attendance.university.edu) — preferred,
//      set it in Vercel project settings alongside VITE_API_URL.
//   2. VERCEL_PROJECT_PRODUCTION_URL (automatic on Vercel).
//   3. VERCEL_URL (preview deployments).
// If none is available the sitemap is skipped (an invalid sitemap is worse
// than none) and robots.txt's Sitemap line is simply ignored by crawlers.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");

const raw =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

const base = raw.replace(/\/+$/, "");
if (!base) {
  console.warn("[sitemap] No SITE_URL/Vercel URL available — skipping sitemap.xml.");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${base}/login</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
`;

writeFileSync(join(dist, "sitemap.xml"), xml);
console.log(`[sitemap] Wrote sitemap.xml for ${base}`);
