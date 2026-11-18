import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import { isValidDayKey } from '~/utils/recapDay'
import { sanitizeAfterMidnight, type AfterMidnightCount } from '~/store/tasks'

/** What a fresh start took off the board as the first half of the panel "Gestern auf dem Board" (#356, #387): the local day it ran on and the ids of the Jetzt and Offen tasks, in board order. */
export interface SentBack {
  day: string
  ids: string[]
  /** Only a day close (#480) writes it: the Wartet tasks it took off the board, the second half of that morning's panel. Absent = none (a fresh start, older data). */
  waiting?: string[]
}

/** A stored `sentBack` as a trusted value: anything but `{ day: YYYY-MM-DD, ids: string[] }` reads as null. */
export function sanitizeSentBack(raw: unknown): SentBack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { day, ids, waiting } = raw as { day?: unknown, ids?: unknown, waiting?: unknown }
  if (!isValidDayKey(day) || !Array.isArray(ids)) return null
  const strings = (list: unknown[]) => list.filter((id): id is string => typeof id === 'string')
  return { day, ids: strings(ids), ...(Array.isArray(waiting) ? { waiting: strings(waiting) } : {}) }
}

/**
 * Day marker of the new-day recap (#385). A stored `archiveDone` (the switch of the recap before #428) is ignored and not written back. Persisted under `day-recap-store` through
 * `appStorage`, so both travel with the data file (export/import, cloud-synced folder) like every other store.
 *
 * It also holds the new day's own state (#356, #387): the day the user last started fresh (`lastNewDay`: the fresh
 * start takes the unfinished cards off the board; since #387 only on the user's click, never by itself), what it
 * took from Jetzt and Offen (`sentBack`, the first half of the panel "Gestern auf dem Board" of that one day), the day the
 * notice that offers the fresh start was closed (`noticeClosedDay`), and the open question about the time a Jetzt
 * timer ran on after midnight while the user was away (`timeOffer`, the user's decision of 2026-11-16: nothing is
 * removed silently). All additive: data stored before them has none and reads as "no start yet, no group, no
 * question". `firstBackDay` and `backNoteClosed` (the one-time note of #356, gone with #387) are no longer read or
 * written: a stored value is ignored.
 *
 * Nothing here writes at hydration (#273): the baseline write ("first run, show nothing") is the caller's
 * decision (`useNewDayRecap`), because it must be skipped while the data status blocks writes (ADR 011).
 */
export const useDayRecapStore = defineStore('dayRecap', () => {
  /** Local day (`YYYY-MM-DD`) the recap was last left on; null until the baseline is written. */
  const lastShownDay = ref<string | null>(null)

  /**
   * Ids the closing step ("Fertig", #292) archived since the recap was last left: the recap still looks back at them
   * next morning, though they are no longer in Erledigt. Cleared when the recap moves the marker.
   */
  const closedTaskIds = ref<string[]>([])

  /**
   * Local day (`YYYY-MM-DD`) the user last started fresh on (#387; before it: the day the automatic pass of #356
   * last ran on), or the baseline of a board that has none yet. Null until then. A later local day is a day that
   * has not been started fresh.
   */
  const lastNewDay = ref<string | null>(null)
  /** The Jetzt and Offen tasks the fresh start of `sentBack.day` took off the board; replaced by the next one. */
  const sentBack = ref<SentBack | null>(null)
  /** Local day on which the user closed the notice that offers the fresh start (#387): it stays away that day. */
  const noticeClosedDay = ref<string | null>(null)
  /**
   * The question of `timeOffer.day`: how long the Jetzt task's timer ran on after midnight while the user was away
   * (`seconds`, with the `spans` it was counted in), for `taskId`. Unanswered it changes nothing (keep is the
   * default); it is shown on its day only, and answered or replaced by a later one it is gone.
   */
  const timeOffer = ref<AfterMidnightCount | null>(null)

  /** `lastNewDay` as a trusted value: a malformed stored string reads as null ("no start yet"). */
  const validLastNewDay = computed(() => (isValidDayKey(lastNewDay.value) ? lastNewDay.value : null))
  /** `sentBack` as a trusted value: a wrongly shaped stored field reads as null ("no group"). */
  const validSentBack = computed<SentBack | null>(() => sanitizeSentBack(sentBack.value))
  /** `timeOffer` as a trusted value: a malformed stored field reads as null ("no question"). */
  const validTimeOffer = computed<AfterMidnightCount | null>(() => {
    const offer = sanitizeAfterMidnight(timeOffer.value)
    return offer && offer.seconds > 0 ? offer : null
  })
  /** `noticeClosedDay` as a trusted value: a malformed stored value reads as null ("not closed"). */
  const validNoticeClosedDay = computed(() => (isValidDayKey(noticeClosedDay.value) ? noticeClosedDay.value : null))

  /**
   * The day `day` is started: by the user's fresh start, which took `ids` (Jetzt first, then Offen) off the board, or
   * without one (none: the baseline, or a day whose board had nothing unfinished). Monotonic like `markShown`: a day
   * that is not after the stored one is ignored, so a second click the same day and a clock set back never repeat it.
   * @returns whether the marker moved
   */
  function markNewDay(day: string, ids: string[]): boolean {
    if (!isValidDayKey(day)) return false
    const current = validLastNewDay.value
    if (current !== null && day <= current) return false
    lastNewDay.value = day
    sentBack.value = { day, ids: [...ids] }
    return true
  }

  /**
   * The user closed the day (#480): the close took the unfinished cards off the board itself, so `nextDay` (the next local
   * day) counts as started and its group "Gestern auf dem Board" (`ids`, Jetzt first, then Offen) shows that
   * morning. `sentBack` keeps its meaning, valid for that one day: the day is tomorrow, written tonight. Monotonic like
   * `markNewDay`, but a second close on the same evening adds its ids in front of the earlier ones instead of being
   * refused; a day before the stored marker (a clock set back) writes nothing. `waiting` (the Wartet tasks the close took off, kept
   * apart from the group) is stored the same way, so the next morning's recap lists only what this evening took off, never an
   * older fresh start's `notPlannedFromWaiting` entries.
   * @returns whether the marker or the group changed
   */
  function markDayClosed(nextDay: string, ids: string[], waiting: string[] = []): boolean {
    if (!isValidDayKey(nextDay)) return false
    const current = validLastNewDay.value
    if (current !== null && nextDay < current) return false
    const earlier = validSentBack.value
    const same = earlier && earlier.day === nextDay ? earlier : null
    const allWaiting = [...new Set([...waiting, ...(same?.waiting ?? [])])]
    lastNewDay.value = nextDay
    sentBack.value = { day: nextDay, ids: [...new Set([...ids, ...(same?.ids ?? [])])], ...(allWaiting.length > 0 ? { waiting: allWaiting } : {}) }
    return true
  }

  /** "Schließen" on the notice that offers the fresh start: it stays away for `day`. */
  function closeNotice(day: string): void {
    if (isValidDayKey(day)) noticeClosedDay.value = day
  }

  /**
   * The day check found time a Jetzt timer counted after midnight while the user was away: it becomes the question
   * of that day. An older question (an earlier day's, unanswered) is replaced; a malformed count is ignored.
   */
  function offerTime(offer: AfterMidnightCount): void {
    const valid = sanitizeAfterMidnight(offer)
    if (!valid || valid.seconds <= 0) return
    timeOffer.value = { ...valid, spans: valid.spans.map(([from, to]) => [from, to] as [number, number]) }
  }

  /**
   * The question was answered (either way): it is not asked again. With a `taskId` only that task's question ends
   * (the user typed its time in the sheet: the typed total is the truth, "Zeit abziehen" must not lower it).
   */
  function resolveTimeOffer(taskId?: string): void {
    if (taskId !== undefined && timeOffer.value?.taskId !== taskId) return
    timeOffer.value = null
  }

  /** `closedTaskIds` as a trusted value: a wrongly shaped stored field (hand-edited file, import) reads as `[]`. */
  const validClosedTaskIds = computed<string[]>(() =>
    Array.isArray(closedTaskIds.value) ? closedTaskIds.value.filter((id): id is string => typeof id === 'string') : [])

  /** `lastShownDay` as a trusted value: a malformed stored string (hand-edited file, import) reads as null. */
  const validLastShownDay = computed(() => (isValidDayKey(lastShownDay.value) ? lastShownDay.value : null))

  /** Monotonic: a key that is not after the stored one is ignored, so a clock set back never moves it back. */
  function markShown(todayKey: string): void {
    if (!isValidDayKey(todayKey)) return
    const current = validLastShownDay.value
    if (current !== null && todayKey <= current) return
    lastShownDay.value = todayKey
    closedTaskIds.value = []
  }

  function rememberClosed(ids: string[]): void {
    closedTaskIds.value = [...new Set([...validClosedTaskIds.value, ...ids])].slice(-500)
  }

  return {
    lastShownDay, closedTaskIds, validClosedTaskIds, validLastShownDay, markShown, rememberClosed,
    lastNewDay, sentBack, noticeClosedDay, timeOffer, validLastNewDay, validSentBack, validNoticeClosedDay, validTimeOffer, markNewDay, markDayClosed, closeNotice, offerTime, resolveTimeOffer,
  }
}, {
  persist: { key: 'day-recap-store', pick: ['lastShownDay', 'closedTaskIds', 'lastNewDay', 'sentBack', 'noticeClosedDay', 'timeOffer'] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDayRecapStore, import.meta.hot))
}
