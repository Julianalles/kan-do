/**
 * @module recapDay
 * @description Pure day logic for the new-day recap (#385): the local day key the marker is stored as,
 * whether the recap is due, and how the page names the day the tasks were finished ("gestern",
 * "am Montag", "am 14. Oktober"). Day distances are local calendar days (`dayNumber`), never 24h windows.
 */
import { dayNumber } from '~/utils/doneDayLabel'
import type { AppLocale } from '~/utils/localeResolution'

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

export type RecapWhenKind = 'yesterday' | 'dayBefore' | 'weekday' | 'date'

export interface RecapWhen {
  kind: RecapWhenKind
  date: Date
}

/** True for a `YYYY-MM-DD` string; the shape is all the marker comparison needs. */
export function isValidDayKey(value: unknown): value is string {
  return typeof value === 'string' && DAY_KEY.test(value)
}

/** Local calendar day as `YYYY-MM-DD` (sorts like the date, so keys compare as strings). */
export function dayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The recap is due when the marker is a valid day before today. A missing or malformed marker is the
 * baseline case (never due); a marker equal to or after today (reload, clock set back) is not due either.
 */
export function isRecapDue(lastShownDay: unknown, todayKey: string): boolean {
  return isValidDayKey(lastShownDay) && lastShownDay < todayKey
}

/**
 * Names the newest completion day relative to `today`: 0 or 1 day back "yesterday" (a timestamp ahead of
 * the clock is clamped), 2 "dayBefore", 3 to 4 "weekday", 5 and more "date".
 */
export function recapWhen(newest: Date, today: Date): RecapWhen {
  const distance = dayNumber(today) - dayNumber(newest)
  if (distance <= 1) return { kind: 'yesterday', date: newest }
  if (distance === 2) return { kind: 'dayBefore', date: newest }
  if (distance <= 4) return { kind: 'weekday', date: newest }
  return { kind: 'date', date: newest }
}

export type BlockWhen = { kind: 'yesterday' } | { kind: 'weekday' | 'date', date: Date }

/** A `YYYY-MM-DD` key as the local date it names (noon, so no daylight-saving change moves it to a neighbour day). */
export function dateOfDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day, 12)
}

/**
 * How the block on top of "Alle Aufgaben" names the day its tasks are from (#741, 2B), seen on `day`: the day before
 * "yesterday", 2 to 6 days back the weekday, 7 and more the date. Without a stored day (older data), a malformed one or
 * one that is not before `day` (a clock set back) it reads "yesterday".
 */
export function blockWhen(from: unknown, day: string): BlockWhen {
  if (!isValidDayKey(from) || !isValidDayKey(day)) return { kind: 'yesterday' }
  const date = dateOfDayKey(from)
  const distance = dayNumber(dateOfDayKey(day)) - dayNumber(date)
  if (distance <= 1) return { kind: 'yesterday' }
  return { kind: distance <= 6 ? 'weekday' : 'date', date }
}

/** "14. Oktober" / "October 14": day and long month, no year. */
export function dayMonthName(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date)
}

/** The local calendar day after `date` as `YYYY-MM-DD` (built from the date parts, so a daylight-saving change never skips or repeats a day). */
export function nextDayKey(date: Date): string {
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))
}
