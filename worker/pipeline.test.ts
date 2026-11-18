// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { COOKIE_NAME, sha256Hex } from './gate'
import { buildCsp } from './csp'
import { handleRequest, type WorkerEnv } from './pipeline'
import { limiterNamespace } from './testing'

const SECRET = 'test-token'
const SITE = 'https://kando.example.workers.dev'
const HASHES = [`sha256-${'A'.repeat(43)}=`]
const CSP = buildCsp(HASHES)

/** Records the order in which gate, origin check, limiter and app see a request. */
function setup(env: Partial<WorkerEnv> = {}, limitSuccess = true) {
  const calls: string[] = []
  const { namespace: NOTION_LIMITER, hit } = limiterNamespace(limitSuccess)
  hit.mockImplementation(async () => { calls.push('limit'); return Response.json({ success: limitSuccess }) })
  const app = vi.fn(async () => { calls.push('app'); return new Response('{}') })
  const full: WorkerEnv = { GATE: 'on', GATE_SECRET: SECRET, NOTION_LIMITER, ...env }
  const run = async (path: string, headers: Record<string, string> = {}, gated = true) => {
    const h = new Headers(headers)
    if (gated) h.set('Cookie', `${COOKIE_NAME}=${await sha256Hex(SECRET)}`)
    return handleRequest(new Request(SITE + path, { headers: h }), full, app, HASHES)
  }
  return { app, calls, run, NOTION_LIMITER }
}

describe('Worker pipeline: gate, then origin check, then rate limit, then the app', () => {
  it('through the gate, a same-origin Notion request is limited, then answered by the app', async () => {
    const { calls, run } = setup()
    expect((await run('/api/notion/pages', { Origin: SITE })).status).toBe(200)
    expect(calls).toEqual(['limit', 'app'])
  })

  it('the gate comes first: without the cookie neither origin check nor limiter nor app run', async () => {
    const { app, calls, run } = setup()
    const res = await run('/api/notion/pages', { Origin: 'https://evil.example' }, false)
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
    expect(app).not.toHaveBeenCalled()
  })

  it('the origin check comes before the limiter: a foreign origin is 403 and uses no quota', async () => {
    const { calls, run } = setup({}, false)
    const res = await run('/api/notion/pages', { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('the limiter comes before the app: over the limit is 429 and the app never runs', async () => {
    const { calls, run } = setup({}, false)
    const res = await run('/api/notion/pages', { Origin: SITE })
    expect(res.status).toBe(429)
    expect(calls).toEqual(['limit'])
  })

  it('guards run with the gate off too (the public launch)', async () => {
    const { calls, run } = setup({ GATE: 'off' })
    expect((await run('/api/notion/pages', { Origin: 'https://evil.example' }, false)).status).toBe(403)
    expect((await run('/api/notion/pages', {}, false)).status).toBe(200)
    expect(calls).toEqual(['limit', 'app'])
  })

  it('the feedback relay stays exempt from gate, origin check and limiter', async () => {
    const { calls, NOTION_LIMITER } = setup({}, false)
    const app = vi.fn(async () => new Response('{}'))
    const env: WorkerEnv = { GATE: 'on', GATE_SECRET: SECRET, NOTION_LIMITER }
    const res = await handleRequest(new Request(`${SITE}/api/feedback`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' }), env, app, HASHES)
    expect(res.status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
    expect(calls).toEqual([])
  })

  describe('Content Security Policy (#504)', () => {
    const html = () => new Response('<!doctype html><p>shell</p>', { headers: { 'Content-Type': 'text/html;charset=utf-8' } })
    const json = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
    const run = (path: string, app: () => Response, env: Partial<WorkerEnv> = {}, gated = true) =>
      sha256Hex(SECRET).then(hash => handleRequest(
        new Request(SITE + path, { headers: gated ? { Cookie: `${COOKIE_NAME}=${hash}` } : {} }),
        { GATE: 'on', GATE_SECRET: SECRET, ...env },
        async () => app(),
        HASHES,
      ))

    it('the app\'s HTML answer carries the policy, nosniff and no-referrer', async () => {
      const res = await run('/tasks', html)
      expect(res.headers.get('Content-Security-Policy')).toBe(CSP)
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow') // the gate still tags it
    })

    it('the policy is on with the gate off too (the public launch)', async () => {
      expect((await run('/', html, { GATE: 'off' }, false)).headers.get('Content-Security-Policy')).toBe(CSP)
    })

    it('the app\'s JSON answers carry none', async () => {
      const res = await run('/api/notion/pages', json)
      expect(res.headers.has('Content-Security-Policy')).toBe(false)
    })

    it('the gate\'s answers are unchanged: the 401 page and the redirect carry no CSP', async () => {
      const denied = await run('/', html, {}, false)
      expect(denied.status).toBe(401)
      expect(denied.headers.has('Content-Security-Policy')).toBe(false)
      const redirect = await handleRequest(new Request(`${SITE}/tasks?secret=${SECRET}`), { GATE: 'on', GATE_SECRET: SECRET }, async () => html(), HASHES)
      expect(redirect.status).toBe(302)
      expect(redirect.headers.has('Content-Security-Policy')).toBe(false)
    })

    it('the guards\' own answers (403, 429) carry none', async () => {
      const { run: guarded } = setup({}, false)
      expect((await guarded('/api/notion/pages', { Origin: 'https://evil.example' })).headers.has('Content-Security-Policy')).toBe(false)
      expect((await guarded('/api/notion/pages', { Origin: SITE })).headers.has('Content-Security-Policy')).toBe(false)
    })

    it('a malformed hash list fails the request instead of serving a widened policy', async () => {
      await expect(handleRequest(new Request(SITE + '/'), { GATE: 'off' }, async () => html(), ["'unsafe-inline'"])).rejects.toThrow(/sha256/)
    })
  })
})
