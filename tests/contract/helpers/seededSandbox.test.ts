// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { isTransientNotionError, withTransientRetry } from './seededSandbox'

const apiError = (status: number, code = 'x') => Object.assign(new Error(`notion ${status}`), { status, code })

describe('isTransientNotionError', () => {
  it.each([429, 500, 502, 503, 504])('treats HTTP %i as transient', (status) => {
    expect(isTransientNotionError(apiError(status))).toBe(true)
  })

  it.each([400, 401, 403, 404, 409])('never treats HTTP %i as transient: a rejected request is a real contract failure', (status) => {
    expect(isTransientNotionError(apiError(status))).toBe(false)
  })

  it('treats the SDK request timeout and a dropped connection as transient', () => {
    expect(isTransientNotionError(Object.assign(new Error('timeout'), { code: 'notionhq_client_request_timeout' }))).toBe(true)
    expect(isTransientNotionError(new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }))).toBe(true)
    expect(isTransientNotionError(new TypeError('fetch failed'))).toBe(true)
  })

  it('does not treat an assertion error or a plain error as transient', () => {
    expect(isTransientNotionError(new Error('expected 8 to be 9'))).toBe(false)
    expect(isTransientNotionError(new TypeError('x is not a function'))).toBe(false)
    expect(isTransientNotionError(undefined)).toBe(false)
    expect(isTransientNotionError('boom')).toBe(false)
  })
})

describe('withTransientRetry', () => {
  it('returns the result without cleanup when the first attempt works', async () => {
    const cleanup = vi.fn()
    expect(await withTransientRetry(async () => 'ok', { cleanup })).toBe('ok')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('cleans up, warns and retries a transient failure, then returns the result', async () => {
    const step = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce('ok')
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const warn = vi.fn()
    expect(await withTransientRetry(step, { cleanup, warn })).toBe('ok')
    expect(step).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('attempt 1/3')
  })

  it('throws a permanent failure at once, without cleanup or a second attempt', async () => {
    const error = apiError(400, 'validation_error')
    const step = vi.fn().mockRejectedValue(error)
    const cleanup = vi.fn()
    await expect(withTransientRetry(step, { cleanup, warn: vi.fn() })).rejects.toBe(error)
    expect(step).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('stops after the attempts and rethrows the last transient failure', async () => {
    const step = vi.fn().mockRejectedValue(apiError(502))
    const cleanup = vi.fn().mockResolvedValue(undefined)
    await expect(withTransientRetry(step, { attempts: 3, cleanup, warn: vi.fn() })).rejects.toMatchObject({ status: 502 })
    expect(step).toHaveBeenCalledTimes(3)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('runs the cleanup before the next attempt starts', async () => {
    const order: string[] = []
    const step = vi.fn(async () => {
      order.push('step')
      if (order.length === 1) throw apiError(500)
      return 'ok'
    })
    await withTransientRetry(step, { cleanup: async () => { order.push('cleanup') }, warn: vi.fn() })
    expect(order).toEqual(['step', 'cleanup', 'step'])
  })
})
