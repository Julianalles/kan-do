/**
 * #527: on desktop `NotionClientAPI` calls the Tauri HTTP plugin's `fetch`, which only stops a request through an
 * abort signal. The request timer (`DEFAULT_TIMEOUT_MS`) must therefore abort the signal handed to it, for the first
 * request, the retry and the body read.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NotionClientAPI, NotionAPIError } from '../../integrations/NotionClientAPI'

const tauriFetch = vi.fn<(url: string, init: { signal?: AbortSignal; method?: string }) => Promise<any>>()
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (url: string, init: any) => tauriFetch(url, init) }))

/** Never answers; rejects as the plugin does ("Request cancelled") once its signal aborts. */
const stalled = (_url: string, init: { signal?: AbortSignal }): Promise<never> =>
  new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Request cancelled'))))

const ok = { ok: true, status: 200, json: () => Promise.resolve({ success: true }) }

describe('NotionClientAPI on desktop: the request timeout (#527)', () => {
  let api: NotionClientAPI

  beforeEach(() => {
    vi.useFakeTimers()
    ;(window as any).__TAURI_INTERNALS__ = {}
    tauriFetch.mockReset()
    api = new NotionClientAPI('token')
  })

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__
    vi.useRealTimers()
  })

  it('hands the plugin a signal that is not aborted while the request is under way', async () => {
    tauriFetch.mockResolvedValueOnce(ok)
    await api.request('GET', '/databases/db-1')
    const init = tauriFetch.mock.calls[0]![1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal!.aborted).toBe(false)
  })

  it('aborts a request that gets no answer within the timeout: a create is rejected as status 0 and sent once', async () => {
    tauriFetch.mockImplementation(stalled)
    const result = api.request('POST', '/pages', { properties: {} })
    const failure = expect(result).rejects.toMatchObject({ name: 'NotionAPIError', statusCode: 0 })
    await vi.advanceTimersByTimeAsync(10_000)
    await failure
    expect(tauriFetch).toHaveBeenCalledTimes(1) // #528: a create is never sent twice
    expect(tauriFetch.mock.calls[0]![1].signal!.aborted).toBe(true)
  })

  it('retries a request that timed out once, with a signal of its own, and that one times out too', async () => {
    tauriFetch.mockImplementation(stalled)
    const result = api.request('GET', '/databases/db-1')
    const failure = expect(result).rejects.toBeInstanceOf(NotionAPIError)
    await vi.advanceTimersByTimeAsync(10_000) // first request aborted
    await vi.advanceTimersByTimeAsync(300) // backoff
    expect(tauriFetch).toHaveBeenCalledTimes(2)
    const [first, second] = tauriFetch.mock.calls.map((call) => call[1].signal!)
    expect(first!.aborted).toBe(true)
    expect(second).not.toBe(first)
    expect(second!.aborted).toBe(false) // the retry has its own timer
    await vi.advanceTimersByTimeAsync(10_000)
    await failure
    expect(second!.aborted).toBe(true)
    expect(tauriFetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the timer armed while the body is read: a stalled body is aborted too', async () => {
    const stalledBody = (signal: AbortSignal) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Request cancelled')))),
    })
    tauriFetch
      .mockImplementationOnce(async (_url, init) => stalledBody(init.signal!))
      .mockResolvedValueOnce(ok)
    const result = api.request('GET', '/databases/db-1')
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(300)
    await expect(result).resolves.toEqual({ success: true })
    expect(tauriFetch).toHaveBeenCalledTimes(2)
  })

  it('leaves no timer behind after a normal answer', async () => {
    tauriFetch.mockResolvedValueOnce(ok)
    await api.request('GET', '/databases/db-1')
    expect(vi.getTimerCount()).toBe(0)
  })
})
