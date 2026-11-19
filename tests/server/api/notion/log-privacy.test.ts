import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import type { EventHandler } from 'h3'
import supertest from 'supertest'

/**
 * #511: the public Worker persists the console (Workers Logs). No Notion route may log task content, an error
 * object, a message, a body or a token, on a failure or on a success, in any NODE_ENV.
 */
const TITLE = 'Quarterly salary review for Jane'
const TOKEN = 'secret_AbCdEf1234567890'

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

function spyConsole() {
  return CONSOLE_METHODS.map(m => vi.spyOn(console, m).mockImplementation(() => {}))
}

function loggedText(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return spies.flatMap(s => s.mock.calls.flat()).map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' | ')
}

/** What @notionhq/client's APIResponseError carries. */
function notionError(status: number, code: string) {
  return Object.assign(new Error(`validation failed for ${TITLE}`), {
    name: 'APIResponseError',
    status,
    code,
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ object: 'error', message: TITLE, request: { auth: TOKEN } }),
  })
}

function mockClient(methods: Record<string, unknown>) {
  vi.doMock('@notionhq/client', () => ({
    Client: vi.fn().mockImplementation(function () { return methods }),
  }))
}

function mountAt(path: string, handler: EventHandler) {
  const app = createApp()
  app.use(path, handler)
  return supertest(toNodeListener(app))
}

function expectNoLeak(text: string) {
  for (const secret of [TITLE, TOKEN, 'validation failed', 'Bearer', 'authorization']) expect(text).not.toContain(secret)
}

describe('Notion routes log no content (#511)', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('query-data-source: a Notion failure logs code, status and route only', async () => {
    const spies = spyConsole()
    mockClient({ request: vi.fn().mockRejectedValue(notionError(404, 'object_not_found')) })
    const handler = (await import('~/server/api/notion/query-data-source.post')).default
    const res = await mountAt('/api/notion/query-data-source', handler)
      .post('/api/notion/query-data-source')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ dataSourceId: 'ds-1', filter: { property: 'Name', title: { equals: TITLE } } })

    expect(res.status).toBe(404)
    const out = loggedText(spies)
    expect(out).toContain('route=/api/notion/query-data-source')
    expect(out).toContain('status=404')
    expect(out).toContain('code=object_not_found')
    expectNoLeak(out)
  })

  it('create-task: a Notion failure logs code, status and route only, not the task being created', async () => {
    const spies = spyConsole()
    mockClient({ pages: { create: vi.fn().mockRejectedValue(notionError(400, 'validation_error')) } })
    const handler = (await import('~/server/api/notion/create-task.post')).default
    const res = await mountAt('/api/notion/create-task', handler)
      .post('/api/notion/create-task')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ databaseId: 'db-1', properties: { Name: { title: [{ text: { content: TITLE } }] } } })

    expect(res.status).toBe(400)
    const out = loggedText(spies)
    expect(out).toContain('code=validation_error')
    expectNoLeak(out)
  })

  it('database: a Notion failure logs code, status and route only', async () => {
    const spies = spyConsole()
    mockClient({ databases: { retrieve: vi.fn().mockRejectedValue(notionError(404, 'object_not_found')) } })
    const handler = (await import('~/server/api/notion/database.get')).default
    const res = await mountAt('/api/notion/database', handler)
      .get('/api/notion/database?id=db-secret')
      .set('Authorization', `Bearer ${TOKEN}`)

    expect(res.status).toBe(404)
    const out = loggedText(spies)
    expect(out).toContain('route=/api/notion/database')
    expect(out).toContain('code=object_not_found')
    expect(out).not.toContain('db-secret')
    expectNoLeak(out)
  })

  it('databases: a failed details lookup falls back and logs code, status and route only', async () => {
    const spies = spyConsole()
    const request = vi.fn(async (opts: { path: string }) => {
      if (opts.path === 'search') return { results: [{ object: 'data_source', id: 'ds-1', name: 'Tasks', location: { database_id: 'db-1' } }] }
      throw notionError(403, 'restricted_resource')
    })
    mockClient({ request })
    const handler = (await import('~/server/api/notion/databases.get')).default
    const res = await mountAt('/api/notion/databases', handler)
      .get('/api/notion/databases')
      .set('Authorization', `Bearer ${TOKEN}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const out = loggedText(spies)
    expect(out).toContain('code=restricted_resource')
    expect(out).toContain('status=403')
    expectNoLeak(out)
  })

  it('tasks.get: a Notion failure goes through the sanitized handler', async () => {
    const spies = spyConsole()
    mockClient({ request: vi.fn().mockRejectedValue(notionError(429, 'rate_limited')) })
    const handler = (await import('~/server/api/notion/tasks.get')).default
    const res = await mountAt('/api/notion/tasks', handler)
      .get('/api/notion/tasks')
      .set('Authorization', `Bearer ${TOKEN}`)
      .query({
        databaseId: 'db-1',
        dataSourceId: 'ds-1',
        propertyMapping: JSON.stringify({ title: 'Name', status: 'Status' }),
        statusMapping: JSON.stringify({ today: 'Offen', doing: 'Jetzt', done: 'Erledigt' }),
      })

    expect(res.status).toBe(429)
    const out = loggedText(spies)
    expect(out).toContain('code=rate_limited')
    expectNoLeak(out)
  })

  describe.each(['production', 'development', ''])('NODE_ENV=%j on success', (env) => {
    const page = { id: 'page-1', object: 'page', properties: { Name: { title: [{ plain_text: TITLE }] } } }
    const query = {
      databaseId: 'db-1',
      dataSourceId: 'ds-1',
      propertyMapping: JSON.stringify({ title: 'Name', status: 'Status', priority: null }),
      statusMapping: JSON.stringify({ today: 'Offen', doing: 'Jetzt', done: 'Erledigt', waiting: null, archive: 'Archiv' }),
    }

    it('tasks.get returns the pages and logs nothing', async () => {
      vi.stubEnv('NODE_ENV', env)
      const spies = spyConsole()
      mockClient({ request: vi.fn().mockResolvedValue({ results: [page] }) })
      const handler = (await import('~/server/api/notion/tasks.get')).default
      const res = await mountAt('/api/notion/tasks', handler).get('/api/notion/tasks').set('Authorization', `Bearer ${TOKEN}`).query(query)

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(loggedText(spies)).toBe('')
    })

    it('archived-tasks returns the pages and logs nothing', async () => {
      vi.stubEnv('NODE_ENV', env)
      const spies = spyConsole()
      mockClient({ request: vi.fn().mockResolvedValue({ results: [page], has_more: false }) })
      const handler = (await import('~/server/api/notion/archived-tasks.get')).default
      const res = await mountAt('/api/notion/archived-tasks', handler).get('/api/notion/archived-tasks').set('Authorization', `Bearer ${TOKEN}`).query(query)

      expect(res.status).toBe(200)
      expect(loggedText(spies)).toBe('')
    })
  })
})
