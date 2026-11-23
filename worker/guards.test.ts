// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NOT_AVAILABLE, guard, isNotionPath } from './guards'

const SITE = 'https://kando.example.workers.dev'

function setup() {
  const app = vi.fn(async (_request: Request) => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))
  const run = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    guard(new Request(SITE + path, { method, headers }), app)
  return { app, run }
}

describe('isNotionPath', () => {
  it('matches the Notion paths and their look-alikes the router could still route', () => {
    for (const p of ['/api/notion/pages', '/api/notion/', '/api/notion', '//api/notion/pages', '/api//notion/pages', '/api/%6Eotion/pages', '/API/Notion/pages', '/api/notion/%zz']) {
      expect(isNotionPath(p), p).toBe(true)
    }
  })

  it('leaves every other path alone', () => {
    for (const p of ['/', '/tasks', '/api/feedback', '/api/notionx', '/x/api/notion/pages', '/_nuxt/notion.js', '/settings/notion']) {
      expect(isNotionPath(p), p).toBe(false)
    }
  })
})

describe('Notion on the local-only instance (#742)', () => {
  it('every /api/notion/* request is 404 NOT_AVAILABLE and never reaches the app, with or without a token', async () => {
    const { app, run } = setup()
    for (const [path, method] of [['/api/notion/pages', 'GET'], ['/api/notion/databases', 'GET'], ['/api/notion/create-task', 'POST'], ['/api/notion/update-task', 'PATCH'], ['//api/%6Eotion/tasks', 'GET']] as const) {
      const res = await run(path, { Authorization: 'Bearer secret_x', Origin: SITE }, method)
      expect(res.status, path).toBe(404)
      const body = await res.json() as { statusCode: number, data: { error: string } }
      expect(body.statusCode).toBe(404)
      expect(body.data.error).toBe(NOT_AVAILABLE)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(app).not.toHaveBeenCalled()
  })

  it('other paths go to the app: pages, assets, the feedback relay', async () => {
    const { app, run } = setup()
    for (const p of ['/', '/tasks', '/settings/notion', '/_nuxt/app.js']) expect((await run(p)).status, p).toBe(200)
    expect((await run('/api/feedback', { Origin: 'https://evil.example' }, 'POST')).status).toBe(200)
    expect(app).toHaveBeenCalledTimes(5)
  })
})
