// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createApp, eventHandler, toNodeListener, createError } from 'h3'
import supertest from 'supertest'
import { throwApiError, handleNotionError } from '../../utils/apiError'

interface HttpError extends Error {
  statusCode?: number
  statusMessage?: string
  data?: any
}

describe('Error Handling', () => {
  let app: any
  let request: any

  beforeAll(async () => {
    // Mock console.error to avoid cluttering test output
    vi.spyOn(console, 'error').mockImplementation(() => {})
    
    // Create a test H3 app
    app = createApp()
    
    // Test route that throws different types of errors
    app.use('/test/validation', eventHandler(() => {
      const error = createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: {
          error: 'VALIDATION_ERROR',
          message: 'Validation failed: Required field missing'
        }
      })
      throw error
    }))

    app.use('/test/not-found', eventHandler(() => {
      throwApiError(404, 'Resource not found', 'NOT_FOUND')
    }))

    app.use('/test/unauthorized', eventHandler(() => {
      const error = new Error('Unauthorized') as HttpError
      error.name = 'UnauthorizedError'
      error.statusCode = 401
      error.statusMessage = 'Unauthorized'
      error.data = {
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
      throw error
    }))

    app.use('/test/api-error', eventHandler(() => {
      throwApiError(400, 'Custom error message', { error: 'CUSTOM_ERROR' })
    }))

    app.use('/test/notion-error', eventHandler(() => {
      const notionError = new Error('Notion API Error')
      notionError.name = 'APIResponseError'
      handleNotionError(notionError)
    }))

    for (const status of [403, 404, 429, 500]) {
      app.use(`/test/notion-status/${status}`, eventHandler(() => {
        const notionError = Object.assign(new Error('Notion API Error'), { name: 'APIResponseError', status })
        handleNotionError(notionError)
      }))
    }

    request = supertest(toNodeListener(app))
  })

  afterAll(() => {
    // Restore console.error
    vi.restoreAllMocks()
  })

  it('handles validation errors with 400 status', async () => {
    const res = await request.get('/test/validation')
    
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error: 'VALIDATION_ERROR',
        message: 'Validation failed: Required field missing'
      }
    })
  })

  it('handles not found errors with 404 status', async () => {
    const res = await request.get('/test/not-found')
    
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: {
        error: 'NOT_FOUND',
        message: 'Resource not found'
      }
    })
  })

  it('handles unauthorized errors with 401 status', async () => {
    const res = await request.get('/test/unauthorized')
    
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: {
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    })
  })

  it('handles custom ApiError with custom status and data', async () => {
    const res = await request.get('/test/api-error')
    
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error: 'CUSTOM_ERROR',
        message: 'Custom error message'
      }
    })
  })
  
  it.each([
    [403, 'Forbidden'],
    [404, 'Not Found'],
  ])('passes a Notion %i through with the NOTION_API_ERROR shape (#342)', async (status, statusMessage) => {
    const res = await request.get(`/test/notion-status/${status}`)

    expect(res.status).toBe(status)
    expect(res.body).toMatchObject({
      statusCode: status,
      statusMessage,
      data: { error: 'NOTION_API_ERROR', message: 'Notion API Error' }
    })
  })

  it('keeps mapping other Notion statuses (500) to 502', async () => {
    const res = await request.get('/test/notion-status/500')
    expect(res.status).toBe(502)
  })

  it('handles Notion API errors with 502 status', async () => {
    const res = await request.get('/test/notion-error')
    
    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      data: {
        error: 'NOTION_API_ERROR',
        message: 'Notion API Error'
      }
    })
  })
})

describe('Notion Retry-After on a 429 (#526)', () => {
  const HTTP_DATE = 'Wed, 21 Oct 2026 07:28:00 GMT'

  /** What `APIResponseError` carries: `headers` as a `Headers` object or a plain record. */
  function notionError(status: number, headers: unknown) {
    return Object.assign(new Error('Notion API Error'), { name: 'APIResponseError', status, code: status === 429 ? 'rate_limited' : 'internal_server_error', headers })
  }

  function requestFor(error: unknown, withEvent = true) {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp()
    app.use('/limited', eventHandler((event) => { handleNotionError(error, withEvent ? event : undefined) }))
    return supertest(toNodeListener(app)).get('/limited')
  }

  afterAll(() => vi.restoreAllMocks())

  it.each([
    ['a Headers object', new Headers({ 'Retry-After': '7' }), '7'],
    ['a plain record, any case', { 'retry-after': '12' }, '12'],
    ['an HTTP date', new Headers({ 'retry-after': HTTP_DATE }), HTTP_DATE],
  ])('forwards the header of %s to the browser, so its retry waits as long as Notion asks', async (_label, headers, expected) => {
    const res = await requestFor(notionError(429, headers))
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe(expected)
  })

  it.each([
    ['missing', new Headers()],
    ['no headers at all', undefined],
    ['empty', new Headers({ 'retry-after': ' ' })],
    ['negative', new Headers({ 'retry-after': '-5' })],
    ['not a number or a date', new Headers({ 'retry-after': 'soon, <script>' })],
  ])('sets no Retry-After when Notion\'s is %s', async (_label, headers) => {
    const res = await requestFor(notionError(429, headers))
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBeUndefined()
  })

  it('never sets it on another status', async () => {
    const res = await requestFor(notionError(500, new Headers({ 'retry-after': '7' })))
    expect(res.status).toBe(502)
    expect(res.headers['retry-after']).toBeUndefined()
  })

  it('without an event (a caller that omits it) the 429 still throws, nothing to set', async () => {
    const res = await requestFor(notionError(429, new Headers({ 'retry-after': '7' })), false)
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBeUndefined()
  })
})
