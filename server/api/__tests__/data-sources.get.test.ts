// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

/**
 * Mocks Notion client behaviour for /api/notion/data-sources endpoint
 */

describe('server/api/notion/data-sources.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('maps database_id from details.parent when location missing', async () => {
    const requestSpy = vi.fn().mockImplementation(async ({ path, method, body: _body }: { path: string; method?: string; body?: unknown }) => {
      if (path === 'search') {
        return {
          results: [
            { object: 'data_source', id: 'ds1', data_source: { id: 'ds1', name: 'Alpha Quelle' } },
          ],
        }
      }
      if (path.startsWith('data_sources/') && (method === 'get' || !method)) {
        const id = path.slice('data_sources/'.length)
        if (id === 'ds1') {
          return { parent: { type: 'database_id', database_id: 'db1' }, name: 'Alpha Quelle' }
        }
        return {}
      }
      if (path.startsWith('data_sources/') && method === 'post' && path.endsWith('/query')) {
        return { results: [] }
      }
      throw new Error(`Unexpected request path: ${path}`)
    })

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp(); app.use('/api/notion/data-sources', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/data-sources?includeDetails=true&debug=true').set('Authorization', 'Bearer tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'ds1',
        name: 'Alpha Quelle',
        location: { type: 'database_id', database_id: 'db1' },
        debug: expect.objectContaining({ detailsParentDbId: 'db1' }),
      },
    ])
  })

  it('maps database_id from probe query when details gives no location/parent', async () => {
    const requestSpy = vi.fn().mockImplementation(async ({ path, method, body: _body }: { path: string; method?: string; body?: unknown }) => {
      if (path === 'search') {
        return {
          results: [
            { object: 'data_source', id: 'ds2', data_source: { id: 'ds2', name: null } },
          ],
        }
      }
      if (path.startsWith('data_sources/') && (method === 'get' || !method)) {
        return {} // no details
      }
      if (path.startsWith('data_sources/') && method === 'post' && path.endsWith('/query')) {
        return { results: [ { parent: { type: 'data_source_id', data_source_id: 'ds2', database_id: 'db2' } } ] }
      }
      throw new Error(`Unexpected request path: ${path}`)
    })

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp(); app.use('/api/notion/data-sources', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/data-sources?includeDetails=true&debug=true').set('Authorization', 'Bearer tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'ds2',
        name: null,
        location: { type: 'database_id', database_id: 'db2' },
        debug: expect.objectContaining({ probeDbId: 'db2' }),
      },
    ])
  })
  it.each(['details', 'probe'])('answers 429 with Retry-After when the %s request is rate limited (#539), not a 200 without a location', async (which) => {
    const rateLimited = Object.assign(new Error('rate limited'), {
      name: 'APIResponseError', status: 429, code: 'rate_limited', headers: { 'retry-after': '7' },
    })
    const requestSpy = vi.fn().mockImplementation(async ({ path, method }: { path: string; method?: string }) => {
      if (path === 'search') return { results: [{ object: 'data_source', id: 'ds1', data_source: { id: 'ds1', name: 'Alpha' } }] }
      if (path === 'data_sources/ds1/query' && method === 'post') {
        if (which === 'probe') throw rateLimited
        return { results: [] }
      }
      if (path === 'data_sources/ds1') {
        if (which === 'details') throw rateLimited
        return {}
      }
      throw new Error(`Unexpected request path: ${path}`)
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp(); app.use('/api/notion/data-sources', handler)
    const res = await supertest(toNodeListener(app)).get('/api/notion/data-sources?includeDetails=true').set('Authorization', 'Bearer tkn')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('7')
  })

  it('keeps swallowing a non-429 details failure', async () => {
    const requestSpy = vi.fn().mockImplementation(async ({ path, method }: { path: string; method?: string }) => {
      if (path === 'search') return { results: [{ object: 'data_source', id: 'ds1', data_source: { id: 'ds1', name: 'Alpha' } }] }
      if (path === 'data_sources/ds1/query' && method === 'post') return { results: [] }
      if (path === 'data_sources/ds1') throw Object.assign(new Error('gone'), { name: 'APIResponseError', status: 404 })
      throw new Error(`Unexpected request path: ${path}`)
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp(); app.use('/api/notion/data-sources', handler)
    const res = await supertest(toNodeListener(app)).get('/api/notion/data-sources?includeDetails=true').set('Authorization', 'Bearer tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'ds1', name: 'Alpha', location: null }])
  })
})
