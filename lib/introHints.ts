/**
 * @module introHints
 * @description The rules of the intro hints (#725, base #800), as pure functions over the stored record: which hints
 * exist and in which order, when one has ended, the quiet day after "Schließen", and which one is current. No store,
 * no clock: the day is passed in as a local day key (`dayKey`, `utils/recapDay`), so every rule is unit-tested.
 *
 * The record (`settings-store.introHints`):
 * - `null`: the hints never started. Every install from before #800 reads like this and shows no hint, ever.
 * - `on`: whether hints show at all (#804 turns them off and back on; nothing in #800 sets it to false).
 * - `quietDay`: the local day "Schließen" was last used. No hint shows for the rest of that day (D3 1A).
 * - `hints[id]`: `answered` (the step was done, or the hint was closed) and `days`, the local days it was on screen
 *   without an answer, at most `INTRO_HINT_MAX_DAYS`. A hint that has its three days ends on the next day; a day
 *   away stores nothing, so it does not count.
 *
 * An ended hint never returns by itself: `answered` is never taken back, and `days` only grows.
 */
import { isValidDayKey } from '~/utils/recapDay'

/** The hints, in the order they take turns. #801 adds `weiter`, `auswahl` and `abschluss` here and nowhere else. */
export const INTRO_HINT_ORDER = ['start'] as const

export type IntroHintId = (typeof INTRO_HINT_ORDER)[number]

/** A hint left unanswered on this many days ends (D3 1A). */
export const INTRO_HINT_MAX_DAYS = 3

export interface IntroHintEntry {
  answered: boolean
  days: string[]
}

export interface IntroHintsRecord {
  on: boolean
  quietDay: string | null
  /** Keyed by hint id. A stored id this build does not know is kept and ignored. */
  hints: Record<string, IntroHintEntry>
}

/** The record the welcome setup writes: on, nothing shown, nothing answered. */
export function freshIntroHints(): IntroHintsRecord {
  return { on: true, quietDay: null, hints: {} }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function sanitizeEntry(value: unknown): IntroHintEntry | null {
  if (!isPlainObject(value) || typeof value.answered !== 'boolean' || !Array.isArray(value.days)) return null
  const days = [...new Set(value.days.filter(isValidDayKey))].slice(0, INTRO_HINT_MAX_DAYS)
  return { answered: value.answered, days }
}

/**
 * Reads a stored record tolerantly: anything that is not a record reads as `null` (no hints), a malformed hint entry
 * is dropped, a malformed `quietDay` reads as none. Returns a fresh object, never the stored one.
 */
export function sanitizeIntroHints(value: unknown): IntroHintsRecord | null {
  if (!isPlainObject(value) || typeof value.on !== 'boolean') return null
  const hints: Record<string, IntroHintEntry> = {}
  if (isPlainObject(value.hints)) {
    for (const [id, stored] of Object.entries(value.hints)) {
      const entry = sanitizeEntry(stored)
      if (entry) hints[id] = entry
    }
  }
  return { on: value.on, quietDay: isValidDayKey(value.quietDay) ? value.quietDay : null, hints }
}

/** Answered, or shown on three days and today is not one of them. */
export function isIntroHintEnded(entry: IntroHintEntry | undefined, today: string): boolean {
  if (!entry) return false
  if (entry.answered) return true
  return entry.days.length >= INTRO_HINT_MAX_DAYS && !entry.days.includes(today)
}

/**
 * The one hint to show now, or `null`: the first in the order that has not ended and whose moment has come
 * (`isDue`). None while the hints never started or are off, and none on the day "Schließen" was used.
 */
export function currentIntroHint(
  record: IntroHintsRecord | null,
  today: string,
  isDue: (id: IntroHintId) => boolean,
): IntroHintId | null {
  if (!record || !record.on || record.quietDay === today) return null
  for (const id of INTRO_HINT_ORDER) {
    if (isIntroHintEnded(record.hints[id], today)) continue
    if (isDue(id)) return id
  }
  return null
}

/** Whether showing `id` on `today` needs a write: the day is new for this hint. */
export function needsShownDay(record: IntroHintsRecord | null, id: string, today: string): boolean {
  if (!record) return false
  const entry = record.hints[id]
  if (!entry) return true
  return !entry.answered && !entry.days.includes(today) && entry.days.length < INTRO_HINT_MAX_DAYS
}
