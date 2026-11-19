// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, eventHandler, toNodeListener } from 'h3'
import supertest from 'supertest'
import { logServerError } from '../../utils/serverLog'
import { handleNotionError } from '../../utils/apiError'

const TITLE = 'Quarterly salary review for Jane'
const TOKEN = 'secret_AbCdEf1234567890'

/** Everything any console method received, as one string. */
function logged(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return spies.flatMap(spy => spy.mock.calls.flat()).map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' | ')
}

function spyConsole() {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
}

/** What @notionhq/client's APIResponseError carries: message, code, status, headers and the raw response body. */
function notionError(status: number, code: string) {
  return Object.assign(new Error(`body failed validation: ${TITLE}`), {
    name: 'APIResponseError',
    status,
    code,
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ object: 'error', message: TITLE, request: { auth: TOKEN } }),
    cause: { title: TITLE }
  })
}

function makeEvent(url: string) {
  return { path: url, node: { req: { url, headers: { host: 'kando.test' } } }, context: {} } as never
}

describe('logServerError (#511)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs only status, code and route for a Notion error, nothing of its message, body, headers or token', () => {
    const spies = spyConsole()
    logServerError(notionError(404, 'object_not_found'), makeEvent('/api/notion/tasks?databaseId=db-1&dataSourceId=ds-1'))
    const out = logged(spies)
    expect(out).toContain('status=404')
    expect(out).toContain('code=object_not_found')
    expect(out).toContain('route=/api/notion/tasks')
    for (const secret of [TITLE, TOKEN, 'Bearer', 'validation', 'db-1', 'ds-1', 'authorization']) expect(out).not.toContain(secret)
  })

  it('logs one single string argument per call, never an object', () => {
    const spies = spyConsole()
    logServerError(notionError(500, 'internal_server_error'))
    const calls = spies.flatMap(s => s.mock.calls)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(1)
    expect(typeof calls[0]![0]).toBe('string')
  })

  it('reads the code of an H3 error from data.error and ignores its data.message', () => {
    const spies = spyConsole()
    logServerError({ statusCode: 409, data: { error: 'NOTION_API_ERROR', message: TITLE } })
    const out = logged(spies)
    expect(out).toContain('status=409')
    expect(out).toContain('code=NOTION_API_ERROR')
    expect(out).not.toContain(TITLE)
  })

  it.each([
    ['a string', TITLE],
    ['undefined', undefined],
    ['null', null],
    ['a plain error', new Error(TITLE)]
  ])('falls back to status=500 code=UNKNOWN for %s', (_label, value) => {
    const spies = spyConsole()
    logServerError(value)
    const out = logged(spies)
    expect(out).toContain('status=500')
    expect(out).toContain('code=UNKNOWN')
    expect(out).toContain('route=unknown')
    expect(out).not.toContain(TITLE)
  })

  it('rejects a code that does not look like a stable code', () => {
    const spies = spyConsole()
    logServerError({ status: 400, code: TITLE, data: { error: TOKEN } })
    const out = logged(spies)
    expect(out).toContain('code=UNKNOWN')
    expect(out).not.toContain(TITLE)
    expect(out).not.toContain(TOKEN)
  })

  it('rejects a status outside the HTTP range', () => {
    const spies = spyConsole()
    logServerError({ status: 'oops', code: 'unauthorized' })
    expect(logged(spies)).toContain('status=500')
  })

  it('never logs the query string of the route', () => {
    const spies = spyConsole()
    logServerError(notionError(400, 'validation_error'), makeEvent('/api/notion/database?id=secret-db&x=1'))
    const out = logged(spies)
    expect(out).toContain('route=/api/notion/database')
    expect(out).not.toContain('secret-db')
    expect(out).not.toContain('?')
  })
})

describe('handleNotionError logging (#511)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the response behaviour and logs no error detail', async () => {
    const spies = spyConsole()
    const app = createApp()
    app.use('/api/notion/pages', eventHandler(event => handleNotionError(notionError(404, 'object_not_found'), event)))
    const res = await supertest(toNodeListener(app)).get('/api/notion/pages?databaseId=db-1')
    expect(res.status).toBe(404)
    expect(res.body.data.error).toBe('NOTION_API_ERROR')
    const out = logged(spies)
    expect(out).toContain('route=/api/notion/pages')
    expect(out).toContain('code=object_not_found')
    expect(out).not.toContain(TITLE)
    expect(out).not.toContain(TOKEN)
    expect(out).not.toContain('db-1')
  })
})
