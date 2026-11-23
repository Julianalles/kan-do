/**
 * Secret-launch access gate of the public instance (#279, #502, ADR 021). Pure logic, testable in Node: the Worker
 * entry (`index.ts`) only wires in Nitro's handler. It mirrors the homepage's gate (jaylouiz/jwue-homepage `worker/gate.ts`):
 * one shared token in the Worker secret `GATE_SECRET`; `vars.GATE = "off"` turns the gate off for the public launch.
 *
 * Every request passes through `handle` first (`assets.run_worker_first`), static files included, so nothing of the
 * app reaches a visitor without the token. Exempt: `POST /api/feedback` and its `OPTIONS` preflight (the desktop app
 * posts there without a cookie; the relay has its own hourly cap), and a `GET`/`HEAD` of the public brand assets
 * (`public-assets.ts`, #736), so a link-preview crawler gets the share image and a browser the icons and the manifest.
 * The 401 page carries the share tags for the same crawlers.
 */

import { logWorkerError } from './log'
import { isPublicAssetRequest } from './public-assets'
import { shareMeta } from './share'

/** `__Host-` binds the cookie to this exact host, Secure and Path=/. It moves with the instance to a custom domain. */
export const COOKIE_NAME = '__Host-kd_gate'
export const COOKIE_MAX_AGE = 90 * 24 * 60 * 60
export const ROBOTS_TAG = 'noindex, nofollow'
/** The only path the gate lets through without the token, for POST and OPTIONS only. */
export const FEEDBACK_PATH = '/api/feedback'

export interface GateEnv {
  GATE?: string
  GATE_SECRET?: string
}

/** The app behind the gate: Nitro's handler (the SPA's static files and the API routes). */
export type AppHandler = (request: Request) => Promise<Response>

export type Decision =
  | { kind: 'pass' }
  | { kind: 'robots' }
  | { kind: 'deny' }
  | { kind: 'redirect', location: string, setCookie?: string }
  | { kind: 'serve' }

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

export function gateCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`
}

/** The gate is on unless explicitly switched off, so a missing var fails closed. */
export function gateOn(env: GateEnv): boolean {
  return env.GATE !== 'off'
}

function isFeedbackRequest(request: Request, url: URL): boolean {
  return url.pathname === FEEDBACK_PATH && (request.method === 'POST' || request.method === 'OPTIONS')
}

export async function decide(request: Request, env: GateEnv): Promise<Decision> {
  if (!gateOn(env)) return { kind: 'pass' }
  const url = new URL(request.url)
  if (url.pathname === '/robots.txt') return { kind: 'robots' }
  // Checked before the secret: a `secret` parameter on the relay route is ignored, never turned into a redirect.
  if (isFeedbackRequest(request, url)) return { kind: 'serve' }
  // Same precedence for the brand assets (#736): exact paths, read methods only, a `secret` parameter is ignored.
  if (isPublicAssetRequest(request)) return { kind: 'serve' }

  const secret = env.GATE_SECRET
  if (!secret) {
    logWorkerError('gate: GATE_SECRET is not set, denying every request')
    return { kind: 'deny' }
  }
  const expected = await sha256Hex(secret)
  const hasCookie = readCookie(request.headers.get('Cookie'), COOKIE_NAME) === expected

  if (url.searchParams.has('secret')) {
    const given = url.searchParams.get('secret') ?? ''
    url.searchParams.delete('secret')
    const location = url.href
    // Compare digests, never the raw strings: no early-exit comparison on the secret itself.
    if ((await sha256Hex(given)) === expected) return { kind: 'redirect', location, setCookie: gateCookie(expected) }
    if (hasCookie) return { kind: 'redirect', location }
    return { kind: 'deny' }
  }

  return hasCookie ? { kind: 'serve' } : { kind: 'deny' }
}

function noStore(headers: Record<string, string>): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': ROBOTS_TAG,
    ...headers,
  })
}

export function redirectResponse(location: string, setCookie?: string): Response {
  const headers = noStore({ Location: location })
  if (setCookie) headers.set('Set-Cookie', setCookie)
  return new Response(null, { status: 302, headers })
}

export function robotsResponse(): Response {
  return new Response('User-agent: *\nDisallow: /\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': ROBOTS_TAG },
  })
}

// Self-contained on purpose: this page must not load a single app asset (no script, no stylesheet link, no font).
// Same wording as the homepage's gate page. The share tags (#736) are for link-preview crawlers, which send no cookie.
export function previewPage(origin: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Private Vorschau · Private preview</title>
${shareMeta(origin)}
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: oklch(97.6% 0.008 85);
    color: oklch(21% 0.012 60); font: 1.0625rem/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { padding: 1.5rem; max-width: 32rem; }
  section + section { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid oklch(86% 0.012 80); }
  h1 { margin: 0 0 0.25rem; font: italic 400 1.75rem/1.2 Georgia, 'Times New Roman', serif; }
  p { margin: 0; color: oklch(42% 0.012 60); }
</style>
</head>
<body>
<main>
  <section><h1>Private Vorschau</h1><p>Diese Seite ist noch nicht öffentlich.</p></section>
  <section lang="en"><h1>Private preview</h1><p>This site is not public yet.</p></section>
</main>
</body>
</html>
`
}

/** `origin` is the request's own, so a move to a custom domain needs no change here. */
export function denyResponse(origin: string): Response {
  return new Response(previewPage(origin), {
    status: 401,
    headers: noStore({ 'Content-Type': 'text/html; charset=utf-8' }),
  })
}

/** The whole request path: decide, then answer or hand the request to the app with the gate's header on its response. */
export async function handle(request: Request, env: GateEnv, app: AppHandler): Promise<Response> {
  const decision = await decide(request, env)
  switch (decision.kind) {
    case 'pass':
      return app(request)
    case 'robots':
      return robotsResponse()
    case 'deny':
      return denyResponse(new URL(request.url).origin)
    case 'redirect':
      return redirectResponse(decision.location, decision.setCookie)
    case 'serve': {
      const response = await app(request)
      const tagged = new Response(response.body, response) // the app's headers can be immutable
      tagged.headers.set('X-Robots-Tag', ROBOTS_TAG)
      return tagged
    }
  }
}
