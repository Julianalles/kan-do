import { describe, expect, it } from 'vitest'
import { LEDGER_DAYS, LEDGER_MAX, parseCommands, pruneLedger, sanitizeLedger } from '~/lib/remoteBridge'

const DAY = 24 * 60 * 60 * 1000

describe('sanitizeLedger', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(sanitizeLedger({ a: 5, b: 'x', c: -1, d: NaN, e: null })).toEqual({ a: 5 })
  })
  it('reads anything that is not a plain object as empty', () => {
    for (const value of [null, undefined, 'x', 7, [], [1, 2]]) expect(sanitizeLedger(value)).toEqual({})
  })
})

describe('pruneLedger', () => {
  const now = 100 * DAY
  it('drops entries older than the window', () => {
    expect(pruneLedger({ old: now - (LEDGER_DAYS + 1) * DAY, fresh: now - DAY }, now)).toEqual({ fresh: now - DAY })
  })
  it('keeps only the newest entries beyond the cap', () => {
    const ledger = Object.fromEntries(Array.from({ length: LEDGER_MAX + 20 }, (_, i) => [`c${i}`, now - i * 1000]))
    const pruned = pruneLedger(ledger, now)
    expect(Object.keys(pruned)).toHaveLength(LEDGER_MAX)
    expect(pruned.c0).toBeDefined()
    expect(pruned[`c${LEDGER_MAX + 5}`]).toBeUndefined()
  })
})

describe('parseCommands', () => {
  it('reads valid commands in order', () => {
    const body = { commands: [
      { id: 'a-1', type: 'start_work', payload: { title: 'Größe' }, createdAt: 1 },
      { id: 'b_2', type: 'log_time', payload: { title: 'X', minutes: 5 } },
    ] }
    expect(parseCommands(body).map(c => c.id)).toEqual(['a-1', 'b_2'])
  })
  it('skips malformed entries and never throws', () => {
    const body = { commands: [
      null, 'x', { id: 7, type: 'start_work', payload: {} }, { id: 'ok', type: 'delete_all', payload: {} },
      { id: 'ok', type: 'add_task', payload: null }, { id: 'ok', type: 'add_task', payload: [] }, { id: '../x', type: 'add_task', payload: {} },
      { id: 'good', type: 'add_task', payload: { title: 'T' } },
    ] }
    expect(parseCommands(body).map(c => c.id)).toEqual(['good'])
    for (const value of [null, undefined, {}, { commands: 'x' }, 5]) expect(parseCommands(value)).toEqual([])
  })
})
