// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ATTEMPTS, EXIT, PROBE_BODY, checkRelay, classify, describe as describeResult } from '../../scripts/feedback-relay-check.mjs'

/** #852: the probe that finds a Worker without FEEDBACK_GITHUB_TOKEN. `fetch` is a stub; nothing leaves the test. */

const URL_ = 'https://relay.example/api/feedback'
const answer = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const notConfigured = () => answer(503, { statusCode: 503, data: { error: 'FEEDBACK_NOT_CONFIGURED' } })
const invalid = () => answer(400, { statusCode: 400, data: { error: 'INVALID_TITLE' } })

describe('scripts/feedback-relay-check.mjs', () => {
  it.each([
    [400, { data: { error: 'INVALID_REPORT' } }, 'configured'],
    [400, { data: { error: 'INVALID_TITLE' } }, 'configured'],
    [503, { data: { error: 'FEEDBACK_NOT_CONFIGURED' } }, 'missing'],
    [503, null, 'inconclusive'], // a Cloudflare platform page
    [503, { data: { error: 'SOMETHING_ELSE' } }, 'inconclusive'],
    [400, null, 'inconclusive'], // a 400 that is not the relay's
    [400, { data: { error: 'FEEDBACK_NOT_CONFIGURED' } }, 'inconclusive'],
    [401, null, 'inconclusive'], // the gate
    [201, { ok: true }, 'inconclusive'],
    [201, { ok: true, dryRun: true }, 'inconclusive'],
    [429, { data: { error: 'FEEDBACK_RATE_LIMITED' } }, 'inconclusive'],
    [502, { data: { error: 'GITHUB_ERROR' } }, 'inconclusive'],
  ])('classify(%i, %j) is %s', (status, body, state) => {
    expect(classify(status, body)).toBe(state)
  })

  it('sends one POST with the constant empty body and nothing that could pass as a report', async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => invalid())
    expect(await checkRelay(URL_, { fetchImpl, pauseMs: 0 })).toEqual({ state: 'configured', status: 400 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(URL_)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{}')
    expect(PROBE_BODY).toBe('{}')
  })

  it('a missing token is conclusive at once: no retry', async () => {
    const fetchImpl = vi.fn(async () => notConfigured())
    expect(await checkRelay(URL_, { fetchImpl, pauseMs: 0 })).toEqual({ state: 'missing', status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries an inconclusive answer and takes the first conclusive one', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(answer(503, '<html>error 1102</html>'))
      .mockResolvedValueOnce(notConfigured())
    expect(await checkRelay(URL_, { fetchImpl, pauseMs: 0 })).toEqual({ state: 'missing', status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it(`gives up as inconclusive after ${ATTEMPTS} attempts`, async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await checkRelay(URL_, { fetchImpl, pauseMs: 0 })).toEqual({ state: 'inconclusive', status: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(ATTEMPTS)
  })

  it('maps each state to its own exit code and a line that names host and secret, never a body', () => {
    expect(EXIT).toEqual({ configured: 0, missing: 1, inconclusive: 2 })
    expect(describeResult(URL_, { state: 'configured', status: 400 })).toBe('feedback relay: configured (relay.example)')
    expect(describeResult(URL_, { state: 'missing', status: 503 })).toContain('NOT CONFIGURED')
    expect(describeResult(URL_, { state: 'missing', status: 503 })).toContain('FEEDBACK_GITHUB_TOKEN')
    expect(describeResult(`${URL_}?x=1`, { state: 'inconclusive', status: 401 })).toBe('feedback relay: inconclusive (relay.example answered 401 to the empty probe)')
    expect(describeResult(URL_, { state: 'inconclusive', status: 0 })).toContain('answered nothing')
  })
})
