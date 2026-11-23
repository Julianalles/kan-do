// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logWorkerError } from './log'

/**
 * #540: Workers Logs persist the console, and the Worker stores nothing of a visitor (epic #279, ADR 021). A worker log
 * line is a constant message plus the error's allow-listed name, never the error object, message, stack or cause.
 */
const TITLE = 'Quarterly salary review for Jane'
const TOKEN = 'secret_AbCdEf1234567890'

function spyConsole() {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
}

function logged(spies: Array<ReturnType<typeof vi.spyOn>>): unknown[][] {
  return spies.flatMap(s => s.mock.calls)
}

describe('logWorkerError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the constant message and the error name, nothing the error carries', () => {
    const spies = spyConsole()
    const error = Object.assign(new TypeError(`could not read ${TITLE}`), {
      cause: new Error(TOKEN),
      url: `https://example.test/?secret=${TOKEN}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    error.stack = `TypeError: ${TITLE}\n    at ${TOKEN}`
    logWorkerError('gate: could not read the cookie', error)
    const calls = logged(spies)
    expect(calls).toEqual([['gate: could not read the cookie [TypeError]']])
    const text = JSON.stringify(calls)
    for (const secret of [TITLE, TOKEN, 'Bearer', 'authorization', 'example.test']) expect(text).not.toContain(secret)
  })

  it.each([
    ['a name with spaces', Object.assign(new Error('x'), { name: `Error ${TOKEN}` })],
    ['a name over 40 characters', Object.assign(new Error('x'), { name: 'A'.repeat(41) })],
    ['a name that is no string', Object.assign(new Error('x'), { name: { toString: () => TOKEN } })],
    ['a thrown string', TOKEN],
    ['null', null],
    ['undefined', undefined],
  ])('%s logs UnknownError', (_label, error) => {
    const spies = spyConsole()
    logWorkerError('guards: failed', error)
    expect(logged(spies)).toEqual([['guards: failed [UnknownError]']])
  })

  it('without an error it logs the message alone', () => {
    const spies = spyConsole()
    logWorkerError('gate: GATE_SECRET is not set, denying every request')
    expect(logged(spies)).toEqual([['gate: GATE_SECRET is not set, denying every request']])
  })
})
