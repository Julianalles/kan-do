/**
 * #800: the rules of the intro hints. The order, the three-day rule (days away do not count), the quiet day after
 * "Schließen", and the tolerant reader of the stored record.
 */
import { describe, it, expect } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'
import { currentIntroHint, freshIntroHints, INTRO_HINT_ORDER, introHintTextKey, isIntroHintEnded, needsShownDay, sanitizeIntroHints, type IntroHintId, type IntroHintsRecord } from '~/lib/introHints'

const due = () => true
/** Only "Start" has its moment: the rules of one hint, whatever follows it in the order */
const onlyStart = (id: IntroHintId) => id === 'start'
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
    expect(currentIntroHint(answered, '2026-11-24', onlyStart)).toBeNull()
    expect(currentIntroHint(answered, '2027-01-01', onlyStart)).toBeNull()
  })
})

describe('the order of the hints (#801)', () => {
  it('is Start, Weiter, Auswahl, Abschluss', () => {
    expect([...INTRO_HINT_ORDER]).toEqual(['start', 'weiter', 'auswahl', 'abschluss'])
  })

  it('shows the first due hint that has not ended: "Auswahl" before "Abschluss" when both are due', () => {
    const bothDue = (id: IntroHintId) => id === 'auswahl' || id === 'abschluss'
    const answered = { answered: true, days: [] }
    expect(currentIntroHint(record({ hints: { start: answered, weiter: answered } }), '2026-11-24', bothDue)).toBe('auswahl')
    expect(currentIntroHint(record({ hints: { start: answered, weiter: answered, auswahl: answered } }), '2026-11-24', bothDue)).toBe('abschluss')
  })

  it('an ended hint is skipped even while its moment is still there', () => {
    const answered = { answered: true, days: [] }
    expect(currentIntroHint(record({ hints: { start: answered } }), '2026-11-24', due)).toBe('weiter')
  })

  it('reads a record from an older build that holds only "start", and keeps an id this build does not know', () => {
    const stored = { on: true, quietDay: null, hints: { start: { answered: true, days: [] }, planen: { answered: false, days: [] } } }
    const read = sanitizeIntroHints(stored)
    expect(read).toEqual(stored)
    expect(currentIntroHint(read, '2026-11-24', due)).toBe('weiter')
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
    expect(currentIntroHint(record({ hints: { start: { answered: false, days } } }), '2026-11-25', onlyStart)).toBeNull()
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

describe('introHintTextKey (#804): the help in the settings reads the hints\' own texts', () => {
  const read = (locale: object, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale)

  it.each(INTRO_HINT_ORDER.flatMap((id) => [[id, true], [id, false]] as const))('hint %s has a text in both locales (phone: %s)', (id, phone) => {
    const key = introHintTextKey(id, phone)
    expect(typeof read(de, key), `de ${key}`).toBe('string')
    expect(typeof read(en, key), `en ${key}`).toBe('string')
  })

  it.each(INTRO_HINT_ORDER)('hint %s has a title in the help section in both locales', (id) => {
    expect(typeof read(de, `settings.introHints.entries.${id}`)).toBe('string')
    expect(typeof read(en, `settings.introHints.entries.${id}`)).toBe('string')
  })

  it('only "Start" has a text per width', () => {
    expect(introHintTextKey('start', true)).not.toBe(introHintTextKey('start', false))
    expect(introHintTextKey('weiter', true)).toBe(introHintTextKey('weiter', false))
  })
})
