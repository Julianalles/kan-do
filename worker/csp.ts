/**
 * Content Security Policy of the web instance (#504, ADR 021, ADR 012 "Web build"). Pure logic, testable in Node: the
 * Worker entry (`index.ts`) supplies the script hashes that `scripts/csp-hashes.mjs` computed from the built shell.
 *
 * The policy is the desktop's (ADR 012) minus Tauri IPC and the Vercel relay: the web build posts feedback to its own
 * `/api/feedback` and reaches Notion through its own `/api/notion/*`, both `'self'`. `script-src` carries the hashes of the
 * shell's inline scripts (the import map and the `window.__NUXT__` config), never `'unsafe-inline'` or `'unsafe-eval'`.
 * `style-src 'unsafe-inline'` is the same known trade-off as on the desktop (Nuxt UI injects its colour `<style>` at runtime).
 * The header goes on the app's HTML responses only: not on the gate's 401 page or redirects, not on JSON, not on assets.
 */

/** Hosts the webview itself calls besides the app's origin: the Todoist SDK's `fetch` (`integrations/TodoistIntegration.ts`). */
export const CONNECT_HOSTS = ['https://api.todoist.com'] as const

/** Every directive except `script-src`, in header order after `script-src` (which needs the build's hashes). */
function directives(scriptHashes: readonly string[]): Array<[string, string[]]> {
  return [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...scriptHashes.map(hash => `'${hash}'`)]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['font-src', ["'self'"]],
    ['img-src', ["'self'"]],
    ['connect-src', ["'self'", ...CONNECT_HOSTS]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'none'"]],
  ]
}

/** A hash source is `sha256-<base64>`; anything else would let a malformed generated file widen the policy. */
const HASH = /^sha256-[A-Za-z0-9+/]{43}=$/

export function buildCsp(scriptHashes: readonly string[]): string {
  const bad = scriptHashes.filter(hash => !HASH.test(hash))
  if (bad.length) throw new Error(`csp: not a sha256 hash source: ${bad.join(', ')}`)
  return directives(scriptHashes).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ')
}

export function isHtml(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html')
}

/** The hardening headers of an app HTML response. Anything else (JSON, assets, redirects) comes back untouched. */
export function withSecurityHeaders(response: Response, csp: string): Response {
  if (!isHtml(response)) return response
  const secured = new Response(response.body, response) // the app's headers can be immutable
  secured.headers.set('Content-Security-Policy', csp)
  secured.headers.set('X-Content-Type-Options', 'nosniff')
  secured.headers.set('Referrer-Policy', 'no-referrer')
  return secured
}
