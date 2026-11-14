import { describe, it, expect, vi } from 'vitest'
import { LEARNED, createEstimator } from '~/lib/learnedEstimate'
import * as similarity from '~/lib/timeboxSimilarity'

/** A finished task as `completionRecords` hold it; `minutes` is the time actually spent. */
const record = (taskId: string, title: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  taskId, title, activity: null, topic: null, actualTimeSpentSeconds: minutes * 60, timeBoxSeconds: null, ...extra,
})
const card = (title: string, extra: Record<string, unknown> = {}) => ({ id: 'card', title, activity: null, topic: null, ...extra })

describe('createEstimator', () => {
  it('is the weighted median of at least 3 similar finished tasks', () => {
    const estimate = createEstimator([
      record('a', 'Bericht schreiben', 60), record('b', 'Bericht schreiben', 60), record('c', 'Bericht schreiben', 60),
    ])
    expect(estimate(card('Bericht schreiben'))).toBe(60)
  })

  it('gives nothing with fewer than 3 similar tasks, so the caller falls back to 30 min', () => {
    const estimate = createEstimator([record('a', 'Bericht schreiben', 60), record('b', 'Bericht schreiben', 60)])
    expect(estimate(card('Bericht schreiben'))).toBeNull()
    expect(LEARNED.MIN_MATCHES).toBe(3)
  })

  it('gives nothing without history or without a similar title', () => {
    expect(createEstimator([])(card('Bericht schreiben'))).toBeNull()
    const unrelated = createEstimator([record('a', 'Zahnarzt', 20), record('b', 'Zahnarzt', 20), record('c', 'Zahnarzt', 20)])
    expect(unrelated(card('Bericht schreiben'))).toBeNull()
  })

  it('lets a matching activity and topic count: the same words, closer to the same activity', () => {
    const estimate = createEstimator([
      record('a', 'Bericht Quartal', 20, { activity: 'reporting' }),
      record('b', 'Bericht Quartal', 20, { activity: 'reporting' }),
      record('c', 'Bericht Quartal', 20, { activity: 'reporting' }),
      record('d', 'Bericht Entwurf', 120, { activity: 'writing' }),
      record('e', 'Bericht Entwurf', 120, { activity: 'writing' }),
      record('f', 'Bericht Entwurf', 120, { activity: 'writing' }),
    ])
    expect(estimate(card('Bericht', { activity: 'reporting' }))).toBe(20)
    expect(estimate(card('Bericht', { activity: 'writing' }))).toBe(120)
  })

  it('rounds to 5 minutes and clamps to 5-240 minutes', () => {
    const rounded = createEstimator([record('a', 'Mail', 17), record('b', 'Mail', 17), record('c', 'Mail', 17)])
    expect(rounded(card('Mail'))).toBe(15)
    const tiny = createEstimator([record('a', 'Mail', 1), record('b', 'Mail', 1.2), record('c', 'Mail', 1.1)])
    expect(tiny(card('Mail'))).toBe(LEARNED.MIN_MINUTES)
    const long = createEstimator([record('a', 'Umzug', 900), record('b', 'Umzug', 900), record('c', 'Umzug', 900)])
    expect(long(card('Umzug'))).toBe(LEARNED.MAX_MINUTES)
  })

  it('ignores the card\'s own record and records with almost no time', () => {
    const estimate = createEstimator([
      record('card', 'Bericht schreiben', 60), record('b', 'Bericht schreiben', 60), record('c', 'Bericht schreiben', 60),
      record('d', 'Bericht schreiben', 0), record('e', 'Bericht schreiben', 0.5),
    ])
    expect(estimate(card('Bericht schreiben'))).toBeNull() // only b and c count
    expect(estimate({ ...card('Bericht schreiben'), id: 'other' })).toBe(60)
  })

  it('skips malformed records instead of throwing (old or hand-edited data)', () => {
    const estimate = createEstimator([
      null, 'x', 7, [], {}, { title: 3 }, { taskId: 'z', title: 'Bericht schreiben', actualTimeSpentSeconds: 'viel' },
      { taskId: 'y', title: 'Bericht schreiben', actualTimeSpentSeconds: NaN },
      { taskId: 'w', title: 'Bericht schreiben', actualTimeSpentSeconds: 3600, activity: 5, topic: {} },
      record('a', 'Bericht schreiben', 60), record('b', 'Bericht schreiben', 60),
    ])
    expect(estimate(card('Bericht schreiben'))).toBe(60) // w, a, b
    expect(createEstimator(undefined)(card('Bericht schreiben'))).toBeNull()
    expect(createEstimator({ not: 'a list' })(card('Bericht schreiben'))).toBeNull()
  })

  it('gives nothing for a card without a usable title', () => {
    const estimate = createEstimator([record('a', 'Bericht', 60), record('b', 'Bericht', 60), record('c', 'Bericht', 60)])
    expect(estimate({ id: 'x' })).toBeNull()
    expect(estimate(card(''))).toBeNull()
  })

  it('tokenizes each record once, however many cards are estimated', () => {
    const spy = vi.spyOn(similarity, 'normalizeAndTokenize')
    const estimate = createEstimator([record('a', 'Bericht A', 60), record('b', 'Bericht B', 60), record('c', 'Bericht C', 60)])
    const afterBuild = spy.mock.calls.length
    for (let i = 0; i < 20; i++) estimate({ id: `t${i}`, title: `Bericht ${i}`, activity: null, topic: null })
    expect(spy.mock.calls.length - afterBuild).toBe(20) // one per card, none per record
    spy.mockRestore()
  })
})
