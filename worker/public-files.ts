/**
 * The root files of the public launch (#738): `robots.txt`, `sitemap.xml` and `/.well-known/security.txt`, built from the
 * request's own origin (workers.dev today, the custom domain later) instead of static files that would bake one host in
 * (ADR 021). Pure logic, testable in Node: `pipeline.ts` puts it in front of the app, behind the gate. While the gate is on
 * it answers `/robots.txt` itself (disallow-all) before this runs, and `sitemap.xml` and `security.txt` are gated like the
 * rest, so these answers matter once `vars.GATE` is `"off"`.
 */

import { isReadMethod } from './public-assets'

/** Where a researcher reports a vulnerability: the public repo's private vulnerability reporting (no personal address). */
export const SECURITY_CONTACT = 'https://github.com/jaylouiz/kan-do/security/advisories/new'
/** The file says "still maintained" for this long after each request; the Worker is redeployed on every push to `main`. */
export const SECURITY_VALIDITY_DAYS = 180
export const FILE_CACHE = 'public, max-age=3600'

const TEXT = 'text/plain; charset=utf-8'
const XML = 'application/xml; charset=utf-8'

export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
}

/** The one canonical page: the app is a client-rendered SPA with a single public entry (`/tasks` and `/welcome` are redirect targets). */
export function sitemapXml(origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`
}

/** RFC 9116: `Contact` and `Expires` are required, `Expires` an RFC 3339 timestamp. */
export function securityTxt(origin: string, now: Date): string {
  const expires = new Date(now.getTime() + SECURITY_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  return `Contact: ${SECURITY_CONTACT}\nExpires: ${expires}\nPreferred-Languages: de, en\nCanonical: ${origin}/.well-known/security.txt\n`
}

export function publicFile(request: Request, now: Date): Response | undefined {
  if (!isReadMethod(request)) return undefined
  const url = new URL(request.url)
  const origin = url.origin
  let body: string
  let contentType: string
  switch (url.pathname) {
    case '/robots.txt':
      body = robotsTxt(origin)
      contentType = TEXT
      break
    case '/sitemap.xml':
      body = sitemapXml(origin)
      contentType = XML
      break
    case '/.well-known/security.txt':
      body = securityTxt(origin, now)
      contentType = TEXT
      break
    default:
      return undefined
  }
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { 'Content-Type': contentType, 'Cache-Control': FILE_CACHE },
  })
}
