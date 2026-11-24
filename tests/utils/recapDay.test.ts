import { describe, expect, it } from 'vitest'
import { blockWhen, dateOfDayKey, dayKey, dayMonthName, isRecapDue, isValidDayKey, nextDayKey, recapWhen } from '~/utils/recapDay'

describe('dayKey', () => {
  it('is the local calendar day, zero padded', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 9, 22, 0, 0))).toBe('2026-10-22')
  })
})

describe('isValidDayKey', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isValidDayKey('2026-10-22')).toBe(true)
    for (const bad of [null, undefined, '', '2026-1-2', '22.10.2026', '2026-10-22T10:00', 20261022]) {
      expect(isValidDayKey(bad)).toBe(false)
    }
  })
})

describe('isRecapDue', () => {
  it('is due when the marker is a day before today', () => {
    expect(isRecapDue('2026-10-21', '2026-10-22')).toBe(true)
    expect(isRecapDue('2025-12-31', '2026-01-01')).toBe(true)
  })

  it('is not due on the same day or when the clock was set back', () => {
    expect(isRecapDue('2026-10-22', '2026-10-22')).toBe(false)
    expect(isRecapDue('2026-10-25', '2026-10-22')).toBe(false)
  })

  it('is never due without a valid marker (baseline case)', () => {
    expect(isRecapDue(null, '2026-10-22')).toBe(false)
    expect(isRecapDue('yesterday', '2026-10-22')).toBe(false)
  })
})

describe('recapWhen', () => {
  const today = new Date(2026, 9, 22) // Thursday
  const back = (days: number, hour = 15) => new Date(2026, 9, 22 - days, hour)

  it('names 0 and 1 day back "yesterday", 2 "dayBefore", 3 to 4 "weekday", 5 and more "date"', () => {
    expect(recapWhen(back(0), today).kind).toBe('yesterday')
    expect(recapWhen(back(1), today).kind).toBe('yesterday')
    expect(recapWhen(back(2), today).kind).toBe('dayBefore')
    expect(recapWhen(back(3), today).kind).toBe('weekday')
    expect(recapWhen(back(4), today).kind).toBe('weekday')
    expect(recapWhen(back(5), today).kind).toBe('date')
    expect(recapWhen(back(40), today).kind).toBe('date')
  })

  it('clamps a completion ahead of the clock to "yesterday"', () => {
    expect(recapWhen(new Date(2026, 9, 24), today).kind).toBe('yesterday')
  })

  it('counts local calendar days, not 24h windows, across a DST change', () => {
    // Europe/Berlin ends DST on 2026-10-25: the day has 25 hours. Sunday late evening to Wednesday early morning is 3 days.
    const wednesday = new Date(2026, 9, 28, 0, 30)
    expect(recapWhen(new Date(2026, 9, 25, 23, 30), wednesday).kind).toBe('weekday')
    expect(recapWhen(new Date(2026, 9, 26, 23, 30), wednesday).kind).toBe('dayBefore')
    expect(recapWhen(new Date(2026, 9, 27, 0, 10), wednesday).kind).toBe('yesterday')
    expect(recapWhen(new Date(2026, 9, 27, 23, 50), wednesday).kind).toBe('yesterday')
  })
})

describe('dayMonthName', () => {
  it('has no year and follows the locale', () => {
    const date = new Date(2026, 9, 14)
    expect(dayMonthName(date, 'de')).toBe('14. Oktober')
    expect(dayMonthName(date, 'en')).toBe('October 14')
  })
})

describe('nextDayKey (#480)', () => {
  it('is the next local calendar day, across a month end and a year end', () => {
    expect(nextDayKey(new Date(2026, 9, 22, 23, 59))).toBe('2026-10-23')
    expect(nextDayKey(new Date(2026, 9, 31, 21, 0))).toBe('2026-11-01')
    expect(nextDayKey(new Date(2026, 11, 31, 0, 5))).toBe('2027-01-01')
  })
})

describe('blockWhen (#741: the title of the block on "Alle")', () => {
  const DAY = '2026-11-24' // a Tuesday

  it('names the day before "yesterday", 2 to 6 days back the weekday, 7 and more the date', () => {
    expect(blockWhen('2026-11-23', DAY)).toEqual({ kind: 'yesterday' })
    const two = blockWhen('2026-11-22', DAY)
    expect(two.kind).toBe('weekday')
    expect(two.kind === 'weekday' && dayKey(two.date)).toBe('2026-11-22')
    expect(blockWhen('2026-11-18', DAY).kind).toBe('weekday')
    const seven = blockWhen('2026-11-17', DAY)
    expect(seven.kind).toBe('date')
    expect(seven.kind === 'date' && dayMonthName(seven.date, 'de')).toBe('17. November')
    expect(seven.kind === 'date' && dayMonthName(seven.date, 'en')).toBe('November 17')
    expect(blockWhen('2026-10-14', DAY).kind).toBe('date')
  })

  it('counts calendar days across a month and a daylight-saving change', () => {
    expect(blockWhen('2026-10-31', '2026-11-01')).toEqual({ kind: 'yesterday' })
    expect(blockWhen('2026-10-24', '2026-10-26').kind).toBe('weekday') // the clocks went back on the 25th
    expect(dayKey(dateOfDayKey('2026-03-29'))).toBe('2026-03-29')
  })

  it('reads "yesterday" without a stored day, for a malformed one and for one that is not before the block\'s day', () => {
    for (const from of [undefined, null, '', 'gestern', 20261123, DAY, '2026-11-25']) {
      expect(blockWhen(from, DAY)).toEqual({ kind: 'yesterday' })
    }
    expect(blockWhen('2026-11-20', 'heute')).toEqual({ kind: 'yesterday' })
  })
})
