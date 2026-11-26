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
 * "Planen" (#803) is a hint outside `INTRO_HINT_ORDER`: it belongs to "Alle" and BoardPlanNote shows it, so it has
 * its own id in the same record (`hints.planen`) and the same rules (`isIntroHintLive`).
 *
 * The welcome (#853) is the other one: `hints.welcome`, shown once before every other hint, on "Heute" or "Alle". It exists
 * only in a record of version 2 (`v`, written by `freshIntroHints`): a record made before #853 has no `v` and reads as
 * "welcome over", so an install that was already set up never gets a welcome by itself ("Erneut zeigen" writes a fresh
 * record and brings it back). What the welcome says is `resolveIntroWelcome`, a pure rule over the board.
 * - `ownJetzt` (#853): the user put a card into Jetzt themselves. "Weiter" ("Die Zeit läuft jetzt mit") is due only then,
 *   never for a Jetzt card the board starts with (a connection's task, the sample board). Missing reads as false.
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
  if (id === INTRO_PLAN_HINT) return phone ? 'board.planNote.phoneText' : 'board.planNote.description'
  return id === 'start' ? `board.introHint.start.text.${phone ? 'phone' : 'desktop'}` : `board.introHint.${id}.text`
}

/** The i18n key of a hint's title (#853: every note has one, the sentence its text used to start with). */
export function introHintTitleKey(id: IntroHintId | typeof INTRO_PLAN_HINT): string {
  return id === INTRO_PLAN_HINT ? 'board.planNote.title' : `board.introHint.${id}.title`
}

/** A hint left unanswered on this many days ends (D3 1A). */
export const INTRO_HINT_MAX_DAYS = 3

export interface IntroHintEntry {
  answered: boolean
  days: string[]
}

/** The record version that has the welcome (#853). A record without it was made before and never shows one. */
export const INTRO_RECORD_VERSION = 2

export interface IntroHintsRecord {
  on: boolean
  quietDay: string | null
  /** Keyed by hint id. A stored id this build does not know is kept and ignored. */
  hints: Record<string, IntroHintEntry>
  /** `INTRO_RECORD_VERSION` on a record made since #853; absent on an older one (no welcome). */
  v?: number
  /** The user put a card into Jetzt themselves (#853); absent reads as false. */
  ownJetzt?: boolean
}

/** The record the welcome setup writes: on, nothing shown, nothing answered, the welcome ahead. */
export function freshIntroHints(): IntroHintsRecord {
  return { on: true, quietDay: null, hints: {}, v: INTRO_RECORD_VERSION }
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
  return {
    on: value.on,
    quietDay: isValidDayKey(value.quietDay) ? value.quietDay : null,
    hints,
    ...(value.v === INTRO_RECORD_VERSION ? { v: INTRO_RECORD_VERSION } : {}),
    ...(value.ownJetzt === true ? { ownJetzt: true } : {}),
  }
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

// ── The welcome (#853) ────────────────────────────────────────────────────────

/** The welcome's id in the record: one entry, whatever shape it took. */
export const INTRO_WELCOME_HINT = 'welcome'

/** The welcome can show: a record that has one (version 2), running, not on a quiet day, and not ended. */
export function isIntroWelcomeLive(record: IntroHintsRecord | null, today: string): boolean {
  return record?.v === INTRO_RECORD_VERSION && isIntroHintLive(record, INTRO_WELCOME_HINT, today)
}

/** What the welcome reads of the board. Counts, not tasks: the rule stays pure. */
export interface IntroWelcomeBoard {
  /** The place that shows. */
  place: 'today' | 'all'
  /** Cards in today's columns (Offen, Jetzt, Wartet, Erledigt of today). */
  onToday: number
  /** Tasks that wait under "Alle". */
  underAll: number
  /** A connected app, whether or not it sent tasks. */
  connected: boolean
  /** The board holds the sample tasks. */
  sample: boolean
  /** A card lies in Jetzt. */
  jetzt: boolean
  phone: boolean
}

/** The first-experience scenarios of #853 (S1 to S5; S6 is each of them seen from "Alle"). */
export type IntroWelcomeScenario = 'empty' | 'connectedEmpty' | 'underAll' | 'today' | 'sample'

export interface IntroNoteCopy {
  titleKey: string
  textKey: string
}

export interface IntroWelcome {
  scenario: IntroWelcomeScenario
  /** `tour`: three notes with "Weiter". `note`: one note with "Schließen". */
  shape: 'note' | 'tour'
  /** One entry for a note, three for the tour. */
  steps: IntroNoteCopy[]
  /** The note's main button leads to "Alle" ("Aufgaben auswählen") instead of closing. */
  toAll: boolean
  /** The hints this welcome already said: they count as answered when it ends (D3). */
  says: string[]
}

export function introWelcomeScenario(board: Pick<IntroWelcomeBoard, 'onToday' | 'underAll' | 'connected' | 'sample'>): IntroWelcomeScenario {
  if (board.onToday > 0) return board.sample ? 'sample' : 'today'
  if (board.underAll > 0) return 'underAll'
  return board.connected ? 'connectedEmpty' : 'empty'
}

const WELCOME = 'board.welcome'

/**
 * What the welcome says for this board (#853, the scenario table of the issue). The tour runs where cards already lie on
 * "Heute" and "Heute" shows; everywhere else, and always on "Alle", it is one note with the text of its scenario and place.
 */
export function resolveIntroWelcome(board: IntroWelcomeBoard): IntroWelcome {
  const scenario = introWelcomeScenario(board)
  const width = board.phone ? 'phone' : 'desktop'
  const note = (titleKey: string, textKey: string, more: Partial<IntroWelcome> = {}): IntroWelcome =>
    ({ scenario, shape: 'note', steps: [{ titleKey, textKey }], toAll: false, says: [], ...more })

  if (board.place === 'all') {
    // Any task on the board: what lies here and how a card is planned. It stands for the planning note.
    if (scenario === 'underAll' || scenario === 'today' || scenario === 'sample') {
      return note(`${WELCOME}.underAll.title`, `${WELCOME}.underAll.all.${width}`, { says: [INTRO_PLAN_HINT] })
    }
    return note(`${WELCOME}.empty.title`, scenario === 'connectedEmpty' ? `${WELCOME}.connectedEmpty.text` : `${WELCOME}.empty.all`)
  }

  if (scenario === 'today' || scenario === 'sample') {
    // An empty Jetzt opens the phone on "Offen" (kd#191): there the note must not send the user away to it.
    const textWidth = board.phone && !board.jetzt ? 'phoneOpen' : width
    const first: IntroNoteCopy = scenario === 'sample'
      ? { titleKey: `${WELCOME}.tour.sample.title`, textKey: `${WELCOME}.tour.sample.text.${textWidth}` }
      : { titleKey: `${WELCOME}.tour.today.title`, textKey: `${WELCOME}.tour.today.text.${textWidth}` }
    const one: IntroNoteCopy = {
      titleKey: `${WELCOME}.tour.one.title`,
      textKey: board.jetzt ? `${WELCOME}.tour.one.filled` : `${WELCOME}.tour.one.empty.${width}`,
    }
    const done: IntroNoteCopy = { titleKey: `${WELCOME}.tour.done.title`, textKey: `${WELCOME}.tour.done.text` }
    return { scenario, shape: 'tour', steps: [first, one, done], toAll: false, says: ['start'] }
  }
  if (scenario === 'underAll') return note(`${WELCOME}.underAll.title`, `${WELCOME}.underAll.today`, { toAll: true })
  if (scenario === 'connectedEmpty') return note(`${WELCOME}.empty.title`, `${WELCOME}.connectedEmpty.text`)
  return note(`${WELCOME}.empty.title`, `${WELCOME}.empty.today.${width}`)
}
