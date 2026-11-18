// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { FORBIDDEN_ORIGIN, RATE_LIMITED, foreignOrigin, guard, isNotionPath, type GuardEnv } from './guards'
import { limiterNamespace } from './testing'

const SITE = 'https://kando.example.workers.dev'

function setup(env: GuardEnv = {}) {
  const app = vi.fn(async (_request: Request) => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }))
  const run = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    guard(new Request(SITE + path, { method, headers }), env, app)
  return { app, run }
}

describe('isNotionPath', () => {
  it('matches the proxy and its look-alikes the router could still route', () => {
    for (const p of ['/api/notion/pages', '/api/notion/', '/api/notion', '//api/notion/pages', '/api//notion/pages', '/api/%6Eotion/pages', '/API/Notion/pages', '/api/notion/%zz']) {
      expect(isNotionPath(p), p).toBe(true)
    }
  })

  it('leaves every other path alone', () => {
    for (const p of ['/', '/tasks', '/api/feedback', '/api/notionx', '/api/config/notion-key', '/x/api/notion/pages', '/_nuxt/notion.js']) {
      expect(isNotionPath(p), p).toBe(false)
    }
  })
})

describe('origin check', () => {
  it('own origin passes', async () => {
    const { app, run } = setup()
    const res = await run('/api/notion/pages', { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' })
    expect(res.status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
  })

  it('a foreign Origin is refused with 403 FORBIDDEN_ORIGIN and the app is never called', async () => {
    const { app, run } = setup()
    for (const origin of ['https://evil.example', 'http://kando.example.workers.dev', 'https://kando.example.workers.dev:8443', 'https://other.workers.dev', 'null']) {
      const res = await run('/api/notion/pages', { Origin: origin })
      expect(res.status, origin).toBe(403)
      const body = await res.json() as { statusCode: number, data: { error: string, message: string } }
      expect(body.data.error).toBe(FORBIDDEN_ORIGIN)
      expect(body.statusCode).toBe(403)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(app).not.toHaveBeenCalled()
  })

  it('Sec-Fetch-Site cross-site and same-site are refused, same-origin and none pass', async () => {
    const { app, run } = setup()
    expect((await run('/api/notion/pages', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect((await run('/api/notion/pages', { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403)
    expect(app).not.toHaveBeenCalled()
    expect((await run('/api/notion/pages', { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200)
    expect((await run('/api/notion/pages', { 'Sec-Fetch-Site': 'none' })).status).toBe(200)
  })

  it('a cross-site Sec-Fetch-Site is refused even with a matching Origin', async () => {
    const { run } = setup()
    expect((await run('/api/notion/pages', { Origin: SITE, 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
  })

  it('no Origin and no Sec-Fetch-Site (curl, server to server) passes', async () => {
    const { app, run } = setup()
    expect((await run('/api/notion/pages')).status).toBe(200)
    expect((await run('/api/notion/pages', {}, 'POST')).status).toBe(200)
    expect(app).toHaveBeenCalledTimes(2)
  })

  it('the preflight of another site is refused too', async () => {
    const { app, run } = setup()
    const res = await run('/api/notion/pages', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' }, 'OPTIONS')
    expect(res.status).toBe(403)
    expect(app).not.toHaveBeenCalled()
  })

  it('a path the router would still route to the proxy is guarded as well', async () => {
    const { app, run } = setup()
    for (const p of ['//api/notion/pages', '/api/%6Eotion/pages', '/API/NOTION/pages']) {
      expect((await run(p, { Origin: 'https://evil.example' })).status, p).toBe(403)
    }
    expect(app).not.toHaveBeenCalled()
  })

  it('other paths are not checked: pages, assets, the feedback relay (open to every origin by design)', async () => {
    const { app, run } = setup()
    const evil = { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }
    expect((await run('/tasks', evil)).status).toBe(200)
    expect((await run('/_nuxt/entry.js', evil)).status).toBe(200)
    expect((await run('/api/feedback', evil, 'POST')).status).toBe(200)
    expect((await run('/api/feedback', evil, 'OPTIONS')).status).toBe(200)
    expect(app).toHaveBeenCalledTimes(4)
  })

  it('foreignOrigin names the reason without echoing the foreign origin', () => {
    const reason = foreignOrigin(new Request(SITE + '/api/notion/pages', { headers: { Origin: 'https://evil.example' } }))
    expect(reason).toBeTruthy()
    expect(reason).not.toContain('evil')
  })
})

describe('rate limit', () => {
  /** A guard env whose limiter answers `success`; `keys` are the clients it was asked about. */
  const withLimiter = (success: boolean | Error) => {
    const { namespace, hit, keys } = limiterNamespace(success)
    return { ...setup({ NOTION_LIMITER: namespace }), hit, keys }
  }

  it('allowed: the app answers, counted under CF-Connecting-IP', async () => {
    const { app, run, hit, keys } = withLimiter(true)
    expect((await run('/api/notion/pages', { 'CF-Connecting-IP': '203.0.113.7' })).status).toBe(200)
    expect(keys).toEqual(['203.0.113.7'])
    expect(hit).toHaveBeenCalledOnce()
    expect(app).toHaveBeenCalledOnce()
  })

  it('limited: 429 RATE_LIMITED with Retry-After, the app is never called', async () => {
    const { app, run } = withLimiter(false)
    const res = await run('/api/notion/pages', { 'CF-Connecting-IP': '203.0.113.7' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    const body = await res.json() as { data: { error: string } }
    expect(body.data.error).toBe(RATE_LIMITED)
    expect(app).not.toHaveBeenCalled()
  })

  it('binding missing: fails open', async () => {
    const { app, run } = setup({})
    expect((await run('/api/notion/pages')).status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
  })

  it('the object fails (its Free quota included): fails open and logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, run } = withLimiter(new Error('boom'))
    expect((await run('/api/notion/pages')).status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('an answer that is not a clear "no" lets the request through', async () => {
    const namespace = {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('{}') }),
    } as unknown as DurableObjectNamespace
    const { app, run } = setup({ NOTION_LIMITER: namespace })
    expect((await run('/api/notion/pages')).status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
  })

  it('without CF-Connecting-IP all clients share one key rather than skipping the limit', async () => {
    const { run, keys } = withLimiter(true)
    await run('/api/notion/pages')
    expect(keys).toEqual(['unknown'])
  })

  it('clients of one IPv6 /64 share a key', async () => {
    const { run, keys } = withLimiter(true)
    await run('/api/notion/pages', { 'CF-Connecting-IP': '2001:db8:1:2:aaaa::1' })
    await run('/api/notion/pages', { 'CF-Connecting-IP': '2001:DB8:1:2:bbbb:cccc:dddd:eeee' })
    expect(keys).toEqual(['2001:db8:1:2', '2001:db8:1:2'])
  })

  it('only /api/notion/* is counted', async () => {
    const { app, run, hit } = withLimiter(false)
    for (const p of ['/', '/tasks', '/_nuxt/entry.js', '/api/feedback']) expect((await run(p)).status, p).toBe(200)
    expect(hit).not.toHaveBeenCalled()
    expect(app).toHaveBeenCalledTimes(4)
  })

  it('a refused origin is not counted against the limit', async () => {
    const { run, hit } = withLimiter(true)
    await run('/api/notion/pages', { Origin: 'https://evil.example' })
    expect(hit).not.toHaveBeenCalled()
  })
})
