import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/database.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns 400 when token is missing', async () => {
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database')
    expect(res.status).toBe(400)
  })

  it('retrieves a specific database by id', async () => {
    const mockDatabase = {
      id: 'db-123',
      title: [{ plain_text: 'My DB' }],
    }
    const databasesRetrieve = vi.fn().mockResolvedValue(mockDatabase)
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return {
        databases: { retrieve: databasesRetrieve },
        }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?id=db-123').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('db-123')
    expect(databasesRetrieve).toHaveBeenCalledWith({ database_id: 'db-123' })
  })

  it('accepts the token from the Authorization header (client proxy mode)', async () => {
    const mockDatabase = { id: 'db-123', title: [{ plain_text: 'My DB' }] }
    const databasesRetrieve = vi.fn().mockResolvedValue(mockDatabase)
    const clientCtor = vi.fn().mockImplementation(function () {
      return { databases: { retrieve: databasesRetrieve } }
    })
    vi.doMock('@notionhq/client', () => ({ Client: clientCtor }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .get('/api/notion/database?id=db-123')
      .set('Authorization', 'Bearer header-token')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('db-123')
    expect(clientCtor).toHaveBeenCalledWith(expect.objectContaining({ auth: 'header-token' }))
    expect(databasesRetrieve).toHaveBeenCalledWith({ database_id: 'db-123' })
  })

  it('lists all databases when no id is provided', async () => {
    const searchResults = [
      { id: 'db-1', title: [{ plain_text: 'First' }] },
      { id: 'db-2', title: [{ plain_text: 'Second' }] },
    ]
    const notionSearch = vi.fn().mockResolvedValue({ results: searchResults })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return {
        search: notionSearch,
        }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toEqual({ id: 'db-1', title: [{ plain_text: 'First' }] })
    expect(notionSearch).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { property: 'object', value: 'database' } }),
    )
  })

  it('returns stubbed databases when stub mode is enabled (list)', async () => {
    const stubbedDatabases = [
      { id: 'stub-db-1', title: 'Stub DB 1' },
      { id: 'stub-db-2', title: 'Stub DB 2' },
    ]
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedDatabases: vi.fn().mockReturnValue(stubbedDatabases),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'stub-db-1', title: 'Stub DB 1' },
      { id: 'stub-db-2', title: 'Stub DB 2' },
    ])
  })

  it('returns stubbed single database when stub mode is enabled with id', async () => {
    const stubbedDatabases = [
      { id: 'stub-db-1', title: 'Stub DB 1' },
      { id: 'stub-db-2', title: 'Stub DB 2' },
    ]
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedDatabases: vi.fn().mockReturnValue(stubbedDatabases),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?id=stub-db-1').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('stub-db-1')
  })

  it('returns 404 when stub database not found by id', async () => {
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedDatabases: vi.fn().mockReturnValue([]),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?id=nonexistent').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(404)
  })

  it('keeps the status of a Notion API error (404)', async () => {
    const databasesRetrieve = vi.fn().mockRejectedValue(
      Object.assign(new Error('not found'), { name: 'APIResponseError', status: 404 }),
    )
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return {
        databases: { retrieve: databasesRetrieve },
        }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?id=db-bad').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(404)
  })

  describe('a Notion failure goes through handleNotionError (#539)', () => {
    function notionFailure(status: number, code: string, headers: Record<string, string> = {}) {
      return Object.assign(new Error('raw notion message about Jane'), { name: 'APIResponseError', status, code, headers })
    }

    async function getWith(error: Error) {
      vi.doMock('@notionhq/client', () => ({
        Client: vi.fn().mockImplementation(function () {
          return { databases: { retrieve: vi.fn().mockRejectedValue(error) } }
        }),
      }))
      vi.doMock('~/server/utils/notionStub', () => ({
        isNotionStubEnabled: vi.fn().mockReturnValue(false),
        getStubbedDatabases: vi.fn(),
      }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const handler = (await import('~/server/api/notion/database.get')).default
      const app = createApp()
      app.use('/api/notion/database', handler)
      return supertest(toNodeListener(app)).get('/api/notion/database?id=db-1').set('Authorization', 'Bearer test-token')
    }

    it('forwards Retry-After on a 429', async () => {
      const res = await getWith(notionFailure(429, 'rate_limited', { 'retry-after': '7' }))
      expect(res.status).toBe(429)
      expect(res.headers['retry-after']).toBe('7')
      expect(res.body.data.error).toBe('RATE_LIMITED')
    })

    it('puts no Notion message at the top level of the response', async () => {
      const res = await getWith(notionFailure(404, 'object_not_found'))
      expect(res.status).toBe(404)
      expect(res.body.data.error).toBe('NOTION_API_ERROR')
      expect(String(res.body.message ?? '')).not.toContain('raw notion message')
    })

    it('maps a Notion 500 like the other routes (502)', async () => {
      const res = await getWith(notionFailure(500, 'internal_server_error'))
      expect(res.status).toBe(502)
    })
  })
})
