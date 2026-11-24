/**
 * #800: the rules of the intro hints. The order, the three-day rule (days away do not count), the quiet day after
 * "Schließen", and the tolerant reader of the stored record.
 */
import { describe, it, expect } from 'vitest'
import { currentIntroHint, freshIntroHints, isIntroHintEnded, needsShownDay, sanitizeIntroHints, type IntroHintsRecord } from '~/lib/introHints'

const due = () => true
const record = (over: Partial<IntroHintsRecord> = {}): IntroHintsRecord => ({ ...freshIntroHints(), ...over })

describe('currentIntroHint', () => {
  it('shows nothing while the hints never started (every install from before #800)', () => {
    expect(currentIntroHint(null, '2026-11-24', due)).toBeNull()
  })

  it('shows the first due hint of a started record', () => {
    expect(currentIntroHint(record(), '2026-11-24', due)).toBe('start')
    expect(currentIntroHint(record(), '2026-11-24', () => false)).toBeNull()
  })

  it('shows nothing while the hints are off', () => {
    expect(currentIntroHint(record({ on: false }), '2026-11-24', due)).toBeNull()
  })

  it('is quiet for the rest of the day "Schließen" was used, and not the day after', () => {
    const quiet = record({ quietDay: '2026-11-24' })
    expect(currentIntroHint(quiet, '2026-11-24', due)).toBeNull()
    expect(currentIntroHint(quiet, '2026-11-25', due)).toBe('start')
  })

  it('never returns an answered hint', () => {
    const answered = record({ hints: { start: { answered: true, days: [] } } })
    expect(currentIntroHint(answered, '2026-11-24', due)).toBeNull()
    expect(currentIntroHint(answered, '2027-01-01', due)).toBeNull()
  })
})

describe('the three-day rule', () => {
  const days = ['2026-11-20', '2026-11-23', '2026-11-24']

  it('keeps a hint through its third day and ends it on the next', () => {
    const entry = { answered: false, days }
    expect(isIntroHintEnded(entry, '2026-11-24')).toBe(false)
    expect(isIntroHintEnded(entry, '2026-11-25')).toBe(true)
    expect(isIntroHintEnded(entry, '2026-12-24')).toBe(true)
  })

  it('does not count days away: two shown days with a gap of weeks are still two', () => {
    const entry = { answered: false, days: ['2026-11-01', '2026-11-24'] }
    expect(isIntroHintEnded(entry, '2026-12-24')).toBe(false)
    expect(needsShownDay(record({ hints: { start: entry } }), 'start', '2026-12-24')).toBe(true)
  })

  it('stores a day once and never a fourth', () => {
    const shown = record({ hints: { start: { answered: false, days } } })
    expect(needsShownDay(shown, 'start', '2026-11-24')).toBe(false)
    expect(needsShownDay(shown, 'start', '2026-11-25')).toBe(false)
    expect(needsShownDay(record(), 'start', '2026-11-24')).toBe(true)
    expect(needsShownDay(null, 'start', '2026-11-24')).toBe(false)
  })

  it('an ended hint is not current', () => {
    expect(currentIntroHint(record({ hints: { start: { answered: false, days } } }), '2026-11-25', due)).toBeNull()
  })
})

describe('sanitizeIntroHints', () => {
  it.each([['nothing', undefined], ['null', null], ['a string', 'on'], ['an array', []], ['a record without on', { hints: {} }], ['a non-boolean on', { on: 'yes' }]])(
    'reads %s as never started',
    (_name, bad) => expect(sanitizeIntroHints(bad)).toBeNull(),
  )

  it('keeps a valid record, unknown hint ids included', () => {
    const stored = { on: false, quietDay: '2026-11-24', hints: { start: { answered: true, days: ['2026-11-24'] }, later: { answered: false, days: [] } } }
    expect(sanitizeIntroHints(stored)).toEqual(stored)
  })

  it('drops malformed entries and day keys, and caps the days', () => {
    const read = sanitizeIntroHints({
      on: true,
      quietDay: 'yesterday',
      hints: {
        start: { answered: false, days: ['2026-11-20', 'x', 7, '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'] },
        broken: { answered: 'no', days: [] },
        alsoBroken: null,
      },
    })
    expect(read).toEqual({ on: true, quietDay: null, hints: { start: { answered: false, days: ['2026-11-20', '2026-11-21', '2026-11-22'] } } })
  })

  it('reads malformed hints as none', () => {
    expect(sanitizeIntroHints({ on: true, hints: 'none' })).toEqual({ on: true, quietDay: null, hints: {} })
  })
})
