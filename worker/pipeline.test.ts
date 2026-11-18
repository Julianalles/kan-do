// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { COOKIE_NAME, sha256Hex } from './gate'
import { handleRequest, type WorkerEnv } from './pipeline'

const SECRET = 'test-token'
const SITE = 'https://kando.example.workers.dev'

/** Records the order in which gate, origin check, limiter and app see a request. */
function setup(env: Partial<WorkerEnv> = {}, limitSuccess = true) {
  const calls: string[] = []
  const NOTION_LIMITER = { limit: vi.fn(async () => { calls.push('limit'); return { success: limitSuccess } }) }
  const app = vi.fn(async () => { calls.push('app'); return new Response('{}') })
  const full: WorkerEnv = { GATE: 'on', GATE_SECRET: SECRET, NOTION_LIMITER, ...env }
  const run = async (path: string, headers: Record<string, string> = {}, gated = true) => {
    const h = new Headers(headers)
    if (gated) h.set('Cookie', `${COOKIE_NAME}=${await sha256Hex(SECRET)}`)
    return handleRequest(new Request(SITE + path, { headers: h }), full, app)
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
    const res = await handleRequest(new Request(`${SITE}/api/feedback`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' }), env, app)
    expect(res.status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
    expect(calls).toEqual([])
  })
})
