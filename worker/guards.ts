/**
 * Guards of the Notion proxy on the public instance (#279, #503, ADR 021). Pure logic, testable in Node, stateless:
 * the Worker entry wires them in behind the gate (`pipeline.ts`). They apply to `/api/notion/*` only and run with the
 * gate off too (the public launch). `/api/feedback` is open to every origin by design and never touched.
 *
 * 1. Origin check: a request whose `Origin` is not the Worker's own, or whose `Sec-Fetch-Site` says another site, is
 *    refused with 403 `FORBIDDEN_ORIGIN`, so no other website can use a visitor's browser as a Notion proxy. A request
 *    without `Origin` (curl, server to server) passes: this is no authentication, the visitor's own token still is.
 * 2. Rate limit: the Durable Object `NOTION_LIMITER` (`limiter.ts`, `durable_objects` in `wrangler.jsonc`), one object
 *    per client (`CF-Connecting-IP`, named by a keyed hash, no IP at rest), exact across isolates and locations; over the limit answers 429 `RATE_LIMITED`
 *    (the client retries 429 with backoff). Without the binding (a test) or when the object fails (its Free quota
 *    included), the request passes: the guard never blocks the app by itself. The Workers Rate Limiting binding it
 *    replaced (#503) did not limit on the live instance (#508).
 */
import { LIMIT_PERIOD_SECONDS, clientKey, limiterName } from './limiter'

/** Same shape as the server routes' errors (`createError`), so the client reads `data.error` and `data.message` alike. */
export const FORBIDDEN_ORIGIN = 'FORBIDDEN_ORIGIN'
export const RATE_LIMITED = 'RATE_LIMITED'
export interface GuardEnv {
  /** The `NotionLimiter` Durable Object namespace. When it is missing (a config without it, a test) the limiter is skipped. */
  NOTION_LIMITER?: DurableObjectNamespace
  /** The gate's secret, reused only as the key of the limiter object names (`limiterName`); never stored or logged. */
  GATE_SECRET?: string
}

export type AppHandler = (request: Request) => Promise<Response>

/**
 * Is this the Notion proxy? Decoded, slash-collapsed and case-folded first, so `//api/notion/x`, `/api/%6Eotion/x` or
 * `/API/notion/x` cannot slip past a guard the app's router would still route. Over-matching only guards more.
 */
export function isNotionPath(pathname: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return true // undecodable: not a path the app serves, but never one that skips a guard
  }
  const path = decoded.replace(/\/{2,}/g, '/').toLowerCase()
  return path === '/api/notion' || path.startsWith('/api/notion/')
}

/** Why a request is refused, or null when its origin is fine. */
export function foreignOrigin(request: Request): string | null {
  const own = new URL(request.url).origin
  const origin = request.headers.get('Origin')
  // `Origin: null` (a sandboxed frame, a privacy redirect) is another origin too.
  if (origin !== null && origin !== own) return `Origin ${origin === 'null' ? 'null' : 'of another site'} is not allowed`
  // Only `same-origin` (the app itself) and `none` (typed URL, bookmark) are ours; `same-site` is a sibling host.
  const site = request.headers.get('Sec-Fetch-Site')
  if (site === 'cross-site' || site === 'same-site') return `Sec-Fetch-Site ${site} is not allowed`
  return null
}

function errorResponse(statusCode: 403 | 429, statusMessage: string, error: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ statusCode, statusMessage, data: { error, message } }), {
    status: statusCode,
    statusText: statusMessage,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

export function forbiddenOriginResponse(message: string): Response {
  return errorResponse(403, 'Forbidden', FORBIDDEN_ORIGIN, message)
}

export function rateLimitedResponse(): Response {
  return errorResponse(429, 'Too Many Requests', RATE_LIMITED, 'Too many requests, try again in a minute', {
    'Retry-After': String(LIMIT_PERIOD_SECONDS),
  })
}

/** True when the request is over the limit. A missing or failing binding never limits. */
export async function overLimit(request: Request, env: GuardEnv): Promise<boolean> {
  const limiter = env.NOTION_LIMITER
  if (!limiter) return false
  try {
    const stub = limiter.get(limiter.idFromName(await limiterName(clientKey(request.headers.get('CF-Connecting-IP')), env.GATE_SECRET)))
    const { success } = await (await stub.fetch('https://limiter.invalid/hit', { method: 'POST' })).json<{ success: boolean }>()
    return success === false // anything but a clear "no" lets the request through
  } catch (error) {
    console.error('guards: the rate limiter failed, letting the request through', error)
    return false
  }
}

/** origin check, then rate limit, then the app; anything but `/api/notion/*` goes straight to the app. */
export async function guard(request: Request, env: GuardEnv, app: AppHandler): Promise<Response> {
  if (!isNotionPath(new URL(request.url).pathname)) return app(request)
  const refused = foreignOrigin(request)
  if (refused) return forbiddenOriginResponse(refused)
  if (await overLimit(request, env)) return rateLimitedResponse()
  return app(request)
}
