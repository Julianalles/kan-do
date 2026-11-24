/**
 * @module introHints
 * @description The rules of the intro hints (#725, base #800), as pure functions over the stored record: which hints
 * exist and in which order, when one has ended, the quiet day after "Schließen", and which one is current. No store,
 * no clock: the day is passed in as a local day key (`dayKey`, `utils/recapDay`), so every rule is unit-tested.
 *
 * The record (`settings-store.introHints`):
 * - `null`: the hints never started. Every install from before #800 reads like this and shows no hint, ever.
 * - `on`: whether hints show at all (#804: "Hinweise ausschalten" on a hint and "Ausschalten" in the settings set it to false,
 *   "Erneut zeigen" replaces the whole record with a fresh one).
 * - `quietDay`: the local day "Schließen" was last used. No hint shows for the rest of that day (D3 1A).
 * - `hints[id]`: `answered` (the step was done, or the hint was closed) and `days`, the local days it was on screen
 *   without an answer, at most `INTRO_HINT_MAX_DAYS`. A hint that has its three days ends on the next day; a day
 *   away stores nothing, so it does not count.
 *
 * An ended hint never returns by itself: `answered` is never taken back, and `days` only grows.
 *
 * "Planen" (#803) is the one hint outside `INTRO_HINT_ORDER`: it belongs to "Alle", where the overlay never shows, so it has
 * its own id in the same record (`hints.planen`) and the same rules (`isIntroHintLive`).
 */
import { isValidDayKey } from '~/utils/recapDay'

/**
 * The hints, in the order they take turns (#801: the first one whose moment has come shows, so with four cards in Offen
 * and one done today "Auswahl" comes before "Abschluss"). "Planen" on "Alle" is not in this list: it is `INTRO_PLAN_HINT`
 * (#803), a hint of its own place that the overlay never shows.
 */
export const INTRO_HINT_ORDER = ['start', 'weiter', 'auswahl', 'abschluss'] as const

/** "Auswahl" is due with this many cards in Offen (and an empty Jetzt): stacking helps to pick from a long column. */
export const INTRO_AUSWAHL_MIN_OPEN = 4

export type IntroHintId = (typeof INTRO_HINT_ORDER)[number]

/** The hint of the place "Alle" (#803): the planning note, shown by `BoardPlanNote` and not by the overlay. */
export const INTRO_PLAN_HINT = 'planen'

/**
 * The i18n key of a hint's text (#804): the overlay shows it and the help section in the settings lists it, so the help
 * can never differ from the hints. "Start" has a text per width, and so has "Planen" (#803: the note's sentence on desktop, its
 * one line on a phone). The menu names in "Auswahl" and "Abschluss" are params (`{more}`, `{dayClose}`).
 */
export function introHintTextKey(id: IntroHintId | typeof INTRO_PLAN_HINT, phone: boolean): string {
  if (id === INTRO_PLAN_HINT) return phone ? 'board.planNote.line' : 'board.planNote.description'
  return id === 'start' ? `board.introHint.start.${phone ? 'phone' : 'desktop'}` : `board.introHint.${id}`
}

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
 * The pacing every hint shares: the hints run (a started record, on), today is not the quiet day after a "Schließen", and
 * the hint `id` has not ended. Whether its moment has come is the caller's.
 */
export function isIntroHintLive(record: IntroHintsRecord | null, id: string, today: string): boolean {
  if (!record || !record.on || record.quietDay === today) return false
  return !isIntroHintEnded(record.hints[id], today)
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
  for (const id of INTRO_HINT_ORDER) {
    if (isIntroHintLive(record, id, today) && isDue(id)) return id
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
