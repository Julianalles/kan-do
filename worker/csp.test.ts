// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildCsp, withSecurityHeaders } from './csp'

// A real-looking hash: the policy builder validates the shape (43 base64 characters and one `=`).
const HASH_A = `sha256-${'A'.repeat(43)}=`
const HASH_B = `sha256-${'b+/'.repeat(14)}b=`

const sources = (csp: string, directive: string) =>
  (csp.split('; ').find(part => part.startsWith(`${directive} `)) ?? '').split(' ').slice(1)

describe('buildCsp (the web policy of ADR 021 / ADR 012 "Web build")', () => {
  const csp = buildCsp([HASH_A, HASH_B])

  it('is exactly the issue #504 policy: the directive list and their order', () => {
    expect(csp).toBe([
      "default-src 'self'",
      `script-src 'self' '${HASH_A}' '${HASH_B}'`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self'",
      "connect-src 'self' https://api.todoist.com",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
    ].join('; '))
  })

  it('never uses a wildcard, unsafe-eval, or a blob: / data: source', () => {
    expect(csp).not.toMatch(/\*|unsafe-eval|wasm-unsafe-eval|blob:|data:/)
  })

  it('only style-src allows unsafe-inline; script-src has no inline escape hatch', () => {
    for (const directive of ['default-src', 'script-src', 'connect-src', 'img-src', 'font-src']) {
      expect(sources(csp, directive), directive).not.toContain("'unsafe-inline'")
    }
    expect(sources(csp, 'style-src')).toContain("'unsafe-inline'")
    expect(sources(csp, 'script-src')).not.toContain("'strict-dynamic'")
  })

  it('connect-src is the app origin and Todoist; no Notion, GitHub, Tauri IPC or Vercel host', () => {
    expect(sources(csp, 'connect-src')).toEqual(["'self'", 'https://api.todoist.com'])
  })

  it('without hashes script-src is just self (the shell would be blocked: the build step guards that)', () => {
    expect(sources(buildCsp([]), 'script-src')).toEqual(["'self'"])
  })

  it('refuses anything that is not a sha256 hash source, so a broken generated file cannot widen the policy', () => {
    expect(() => buildCsp(["'unsafe-inline'"])).toThrow(/sha256/)
    expect(() => buildCsp(['https://evil.example'])).toThrow(/sha256/)
    expect(() => buildCsp([`${HASH_A}' 'unsafe-eval`])).toThrow(/sha256/)
  })
})

describe('withSecurityHeaders', () => {
  const csp = buildCsp([HASH_A])

  it('sets the CSP, nosniff and no-referrer on an HTML response and keeps status, body and its other headers', async () => {
    const res = withSecurityHeaders(new Response('<p>app</p>', { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8', 'X-Robots-Tag': 'noindex' } }), csp)
    expect(res.headers.get('Content-Security-Policy')).toBe(csp)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(await res.text()).toBe('<p>app</p>')
  })

  it('leaves JSON, scripts, styles, fonts and header-less responses untouched', () => {
    for (const type of ['application/json', 'text/javascript', 'text/css', 'font/woff2', 'image/svg+xml', 'text/plain']) {
      const res = withSecurityHeaders(new Response('x', { headers: { 'Content-Type': type } }), csp)
      expect(res.headers.has('Content-Security-Policy'), type).toBe(false)
      expect(res.headers.has('X-Content-Type-Options'), type).toBe(false)
    }
    expect(withSecurityHeaders(new Response(null, { status: 204 }), csp).headers.has('Content-Security-Policy')).toBe(false)
  })

  it('replaces a CSP the app set itself rather than adding a second, weaker one', () => {
    const res = withSecurityHeaders(new Response('x', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src *" } }), csp)
    expect(res.headers.get('Content-Security-Policy')).toBe(csp)
  })

  it('works on an immutable response (the headers of a fetched asset)', async () => {
    const immutable = new Response('x', { headers: { 'Content-Type': 'text/html' } })
    Object.defineProperty(immutable.headers, 'set', { value() { throw new TypeError('immutable') } })
    expect(withSecurityHeaders(immutable, csp).headers.get('Content-Security-Policy')).toBe(csp)
  })
})
