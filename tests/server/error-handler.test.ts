// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, createError, eventHandler, send, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'
import type { H3Error, H3Event } from 'h3'
import supertest from 'supertest'
// The built-in handler Nitro hands to a custom one (the same module the virtual error-handler imports in production)
import { defaultHandler } from 'nitropack/runtime/internal/error/prod'
import type { NitroErrorHandler } from 'nitropack/types'
import errorHandler, { createErrorHandler } from '~/server/error-handler'

/**
 * #525: an unhandled throw in a route reached Nitro's `[request error] [unhandled] [METHOD] <url>` log, with the full
 * URL query and the raw error. Workers Logs persist the console. The custom Nitro error handler sends the same
 * response and logs through `logServerError` only.
 */
const SECRET_QUERY = 'databaseId=db-secret-1&propertyMapping=%7B%22status%22%3A%22Phase-Secret%22%7D'
const SECRET_MESSAGE = 'Cannot read properties of null (reading "archive") for Quarterly salary review'

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
function spyConsole() {
  return CONSOLE_METHODS.map(m => vi.spyOn(console, m).mockImplementation(() => {}))
}
function logged(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return spies.flatMap(s => s.mock.calls.flat()).map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' | ')
}

/** An h3 app wired like Nitro: `onError` runs the custom handler with the built-in one as its third argument. */
function appWith(routeHandler: () => unknown, handler: NitroErrorHandler = errorHandler) {
  const app = createApp({
    onError: (error: H3Error, event: H3Event) => handler(error, event, { defaultHandler } as never),
  })
  app.use('/api/notion/tasks', eventHandler(routeHandler as never))
  return supertest(toNodeListener(app))
}

describe('Nitro error handler (#525)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('an unhandled throw logs one [server-error] line with route, status and code, no query, message or stack', async () => {
    const spies = spyConsole()
    const res = await appWith(() => { throw new TypeError(SECRET_MESSAGE) }).get(`/api/notion/tasks?${SECRET_QUERY}`)

    expect(res.status).toBe(500)
    const out = logged(spies)
    expect(out).toBe('[server-error] route=/api/notion/tasks status=500 code=UNKNOWN')
    expect(spies.flatMap(s => s.mock.calls)).toHaveLength(1)
    for (const leak of ['request error', '[h3]', 'db-secret-1', 'Phase-Secret', 'propertyMapping', 'Cannot read', 'salary', 'TypeError', 'at ']) {
      expect(out).not.toContain(leak)
    }
  })

  it('control: Nitro\'s built-in handler alone logs the full URL with the query and the raw error', async () => {
    const spies = spyConsole()
    await appWith(() => { throw new TypeError(SECRET_MESSAGE) }, ((error, event, { defaultHandler: builtin }) => {
      const res = builtin(error, event) as { status: number }
      setResponseStatus(event, res.status)
      return send(event, '{}')
    }) as NitroErrorHandler).get(`/api/notion/tasks?${SECRET_QUERY}`)
    const out = logged(spies)
    expect(out).toContain('[request error]')
    expect(out).toContain('db-secret-1')
  })

  it('the response is the built-in one: JSON 500 "Server Error" without the raw message, with its security headers', async () => {
    spyConsole()
    const res = await appWith(() => { throw new Error(SECRET_MESSAGE) }).get('/api/notion/tasks')

    expect(res.status).toBe(500)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.body).toMatchObject({ error: true, statusCode: 500, message: 'Server Error' })
    expect(JSON.stringify(res.body)).not.toContain('Cannot read')
  })

  it('a thrown H3 error keeps its status, message and data, and logs nothing (the route logged it already)', async () => {
    const spies = spyConsole()
    const res = await appWith(() => {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { error: 'INVALID_JSON', message: 'Invalid mapping' } })
    }).get(`/api/notion/tasks?${SECRET_QUERY}`)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, statusMessage: 'Bad Request', data: { error: 'INVALID_JSON', message: 'Invalid mapping' } })
    expect(logged(spies)).toBe('')
  })

  it('a header set before the throw (the Retry-After of #526) reaches the client', async () => {
    spyConsole()
    const app = createApp({ onError: (error: H3Error, event: H3Event) => errorHandler(error, event, { defaultHandler } as never) })
    app.use('/limited', eventHandler((event) => {
      setResponseHeader(event, 'retry-after' as string, '7')
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests', data: { error: 'RATE_LIMITED' } })
    }))
    const res = await supertest(toNodeListener(app)).get('/limited')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('7')
  })
})

/**
 * Nuxt's handler (`@nuxt/nitro-server`, `runtime/handlers/error`) renders the `/__nuxt_error` page for a document request
 * and leaves a JSON request unhandled. Stand-in: HTML for a request that accepts it, nothing for JSON, calling the
 * `defaultHandler` it is given the way the real one does (a non-silent call logs the URL and the raw error).
 */
const fakeNuxtHandler: NitroErrorHandler = async (error, event, { defaultHandler: builtin }) => {
  if (event.handled) return
  if (String(event.node.req.headers.accept).includes('application/json')) return
  const res = await builtin(error, event, { json: true })
  setResponseStatus(event, res.status)
  setResponseHeader(event, 'content-type', 'text/html;charset=UTF-8')
  setResponseHeader(event, 'vary', 'accept, sec-fetch-mode')
  await send(event, `<html><body>Nuxt error page ${res.status}</body></html>`)
}

describe('Nitro error handler wrapping Nuxt\'s handler (#525)', () => {
  afterEach(() => vi.restoreAllMocks())
  const wrapped = createErrorHandler(fakeNuxtHandler)

  it('a 404 for a document request renders Nuxt\'s error page with its vary header, and logs nothing', async () => {
    const spies = spyConsole()
    const res = await appWith(() => { throw createError({ statusCode: 404, statusMessage: 'Not Found' }) }, wrapped)
      .get(`/api/notion/tasks?${SECRET_QUERY}`).set('accept', 'text/html')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers.vary).toBe('accept, sec-fetch-mode')
    expect(res.text).toContain('Nuxt error page 404')
    expect(logged(spies)).toBe('')
  })

  it('an unhandled throw for a document request renders the page and logs one [server-error] line, never the URL or the error', async () => {
    const spies = spyConsole()
    const res = await appWith(() => { throw new TypeError(SECRET_MESSAGE) }, wrapped)
      .get(`/api/notion/tasks?${SECRET_QUERY}`).set('accept', 'text/html')

    expect(res.status).toBe(500)
    expect(res.text).toContain('Nuxt error page 500')
    const out = logged(spies)
    expect(out).toBe('[server-error] route=/api/notion/tasks status=500 code=UNKNOWN')
    expect(spies.flatMap(s => s.mock.calls)).toHaveLength(1)
  })

  it('a JSON request, which Nuxt\'s handler leaves unhandled, gets the built-in JSON response without the raw message', async () => {
    const spies = spyConsole()
    const res = await appWith(() => { throw new Error(SECRET_MESSAGE) }, wrapped).get('/api/notion/tasks').set('accept', 'application/json')

    expect(res.status).toBe(500)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body).toMatchObject({ error: true, statusCode: 500, message: 'Server Error' })
    expect(logged(spies)).toBe('[server-error] route=/api/notion/tasks status=500 code=UNKNOWN')
  })

  it('a throw inside Nuxt\'s handler is caught: the JSON response goes out and the error is not logged', async () => {
    const spies = spyConsole()
    const broken = createErrorHandler(() => { throw new Error(`render failed for ${SECRET_MESSAGE}`) })
    const res = await appWith(() => { throw new TypeError(SECRET_MESSAGE) }, broken).get(`/api/notion/tasks?${SECRET_QUERY}`)

    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ statusCode: 500, message: 'Server Error' })
    expect(logged(spies)).toBe('[server-error] route=/api/notion/tasks status=500 code=UNKNOWN')
  })

  it('a header set before the throw (Retry-After, #526) survives Nuxt\'s page too', async () => {
    spyConsole()
    const app = createApp({ onError: (error: H3Error, event: H3Event) => wrapped(error, event, { defaultHandler } as never) })
    app.use('/limited', eventHandler((event) => {
      setResponseHeader(event, 'retry-after' as string, '7')
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
    }))
    const res = await supertest(toNodeListener(app)).get('/limited').set('accept', 'text/html')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('7')
  })
})
