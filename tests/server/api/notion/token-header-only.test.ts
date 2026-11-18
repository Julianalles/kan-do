// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

// #503: the Notion token travels only in `Authorization: Bearer`. A `?token=` ends up in logs and analytics, so the
// server ignores it: a request carrying only the query parameter is a request without a token.

async function buildApp() {
  const stub = (await import('~/server/middleware/notion-stub-failure')).default
  const pages = (await import('~/server/api/notion/pages')).default
  const app = createApp()
  app.use(stub)
  app.use('/api/notion/pages', pages)
  return supertest(toNodeListener(app))
}

describe('Notion token: header only (#503)', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('a request with only ?token= answers 400 MISSING_PARAMETERS', async () => {
    const request = await buildApp()
    const res = await request.get('/api/notion/pages?token=tkn')
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('MISSING_PARAMETERS')
    expect(res.body?.data?.missing).toEqual(['token'])
  })

  it('the header wins over a ?token= that disagrees', async () => {
    const search = vi.fn().mockResolvedValue({ results: [] })
    const Client = vi.fn().mockImplementation(function () { return { search } })
    vi.doMock('@notionhq/client', () => ({ Client }))
    const request = await buildApp()
    const res = await request.get('/api/notion/pages?token=from-url').set('Authorization', 'Bearer from-header')
    expect(res.status).toBe(200)
    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ auth: 'from-header' }))
  })

  it('the stub failure middleware reads only the header', async () => {
    const request = await buildApp()
    // `?token=<stub token with fail=500>` is no token: the request reaches the route and is refused there as 400 (the header fails as 502).
    const viaUrl = await request.get('/api/notion/pages?token=notion_test_stub:fail=500:s1')
    expect(viaUrl.status).toBe(400)
    const viaHeader = await request.get('/api/notion/pages').set('Authorization', 'Bearer notion_test_stub:fail=500:s1')
    expect(viaHeader.status).toBe(502)
  })
})
