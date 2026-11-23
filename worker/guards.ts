/**
 * The public instance is local-only (#742, ADR 021 "Local-only"): it offers no Notion, and its build carries no Notion
 * route (`nitro.ignore` in `nuxt.config.ts` for the Cloudflare preset). The Worker still answers `/api/notion/*` itself
 * with 404 `NOT_AVAILABLE`, behind the gate, so no request on that path ever reaches the app: a stray or hand-crafted
 * request never gets the SPA shell's 200 and never hands a Notion token to code that could read it.
 *
 * Replaced: the Notion proxy's origin check and its Durable Object rate limit (#503, #508). Both guarded only those routes.
 */

/** Same shape as the server routes' errors (`createError`), so the client reads `data.error` and `data.message` alike. */
export const NOT_AVAILABLE = 'NOT_AVAILABLE'

export type AppHandler = (request: Request) => Promise<Response>

/**
 * Is this a Notion path? Decoded, slash-collapsed and case-folded first, so `//api/notion/x`, `/api/%6Eotion/x` or
 * `/API/notion/x` cannot slip past. Over-matching only refuses more.
 */
export function isNotionPath(pathname: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return true // undecodable: not a path the app serves, but never one that reaches it
  }
  const path = decoded.replace(/\/{2,}/g, '/').toLowerCase()
  return path === '/api/notion' || path.startsWith('/api/notion/')
}

export function notionNotAvailableResponse(): Response {
  return new Response(
    JSON.stringify({ statusCode: 404, statusMessage: 'Not Found', data: { error: NOT_AVAILABLE, message: 'Notion is not available on this instance' } }),
    { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}

/** `/api/notion/*` answers 404 here; everything else goes to the app. */
export async function guard(request: Request, app: AppHandler): Promise<Response> {
  if (isNotionPath(new URL(request.url).pathname)) return notionNotAvailableResponse()
  return app(request)
}
