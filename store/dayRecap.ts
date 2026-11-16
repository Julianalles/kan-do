import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import { isValidDayKey } from '~/utils/recapDay'
import { sanitizeAfterMidnight, type AfterMidnightCount } from '~/store/tasks'

/** What a new day's pass sent back to "Nicht geplant" (#356): the local day it ran on and the task ids, in board order. */
export interface SentBack {
  day: string
  ids: string[]
}

/** A stored `sentBack` as a trusted value: anything but `{ day: YYYY-MM-DD, ids: string[] }` reads as null. */
export function sanitizeSentBack(raw: unknown): SentBack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { day, ids } = raw as { day?: unknown, ids?: unknown }
  if (!isValidDayKey(day) || !Array.isArray(ids)) return null
  return { day, ids: ids.filter((id): id is string => typeof id === 'string') }
}

/**
 * Day marker and toggle of the new-day recap (#385). Persisted under `day-recap-store` through
 * `appStorage`, so both travel with the data file (export/import, cloud-synced folder) like every other store.
 *
 * Since #356 it also holds the new day's own state: the day the pass "unfinished cards go back to Nicht geplant" last
 * ran on (`lastNewDay`), what it sent back (`sentBack`, the group "Gestern geplant, noch offen" of that one day) and
 * the one-time note of the first pass that ever moved a card (`firstBackDay`, `backNoteClosed`), and the open question
 * about the time a Jetzt timer ran on after midnight while the user was away (`timeOffer`, the user's decision of
 * 2026-11-16: nothing is removed silently). All five are additive: data stored before #356 has none of them and reads as "no pass yet, no group, no note".
 *
 * Nothing here writes at hydration (#273): the baseline write ("first run, show nothing") is the caller's
 * decision (`useNewDayRecap`), because it must be skipped while the data status blocks writes (ADR 011).
 */
export const useDayRecapStore = defineStore('dayRecap', () => {
  /** Local day (`YYYY-MM-DD`) the recap was last left on; null until the baseline is written. */
  const lastShownDay = ref<string | null>(null)
  /** "Erledigte archivieren" on the recap page: on by default, remembers the last choice. */
  const archiveDone = ref(true)

  /**
   * Ids the closing step ("Fertig", #292) archived since the recap was last left: the recap still looks back at them
   * next morning, though they are no longer in Erledigt. Cleared when the recap moves the marker.
   */
  const closedTaskIds = ref<string[]>([])

  /** Local day (`YYYY-MM-DD`) the new-day pass last ran on (#356); null until its first run or baseline. */
  const lastNewDay = ref<string | null>(null)
  /** The tasks the pass of `sentBack.day` took off the board; replaced by the next day's pass. */
  const sentBack = ref<SentBack | null>(null)
  /** The day of the first pass that ever sent a card back: that day the board shows the one-time note. Set once. */
  const firstBackDay = ref<string | null>(null)
  /** The one-time note was closed or its button used. */
  const backNoteClosed = ref(false)
  /**
   * The question the pass of `timeOffer.day` leaves: how long the Jetzt task's timer ran on after midnight while
   * the user was away (`seconds`, with the `spans` it was counted in), for `taskId`. Unanswered it changes nothing
   * (keep is the default); answered or replaced by the next day's pass it is null.
   */
  const timeOffer = ref<AfterMidnightCount | null>(null)

  /** `lastNewDay` as a trusted value: a malformed stored string reads as null ("no pass yet"). */
  const validLastNewDay = computed(() => (isValidDayKey(lastNewDay.value) ? lastNewDay.value : null))
  /** `sentBack` as a trusted value: a wrongly shaped stored field reads as null ("no group"). */
  const validSentBack = computed<SentBack | null>(() => sanitizeSentBack(sentBack.value))
  /** `timeOffer` as a trusted value: a malformed stored field reads as null ("no question"). */
  const validTimeOffer = computed<AfterMidnightCount | null>(() => {
    const offer = sanitizeAfterMidnight(timeOffer.value)
    return offer && offer.seconds > 0 ? offer : null
  })
  /** `firstBackDay` as a trusted value. */
  const validFirstBackDay = computed(() => (isValidDayKey(firstBackDay.value) ? firstBackDay.value : null))

  /**
   * The pass ran on `day` and sent `ids` back (none: a baseline or a day with an empty board). Monotonic like
   * `markShown`: a day that is not after the stored one is ignored, so a clock set back never repeats a pass.
   * @returns whether the marker moved
   */
  function markNewDay(day: string, ids: string[], offer: AfterMidnightCount | null = null): boolean {
    if (!isValidDayKey(day)) return false
    const current = validLastNewDay.value
    if (current !== null && day <= current) return false
    lastNewDay.value = day
    sentBack.value = { day, ids: [...ids] }
    // The question belongs to this pass: an older one is gone with its day
    timeOffer.value = offer ? { ...offer, spans: offer.spans.map(([from, to]) => [from, to] as [number, number]) } : null
    if (ids.length > 0 && validFirstBackDay.value === null) {
      firstBackDay.value = day
      backNoteClosed.value = false
    }
    return true
  }

  function closeBackNote(): void {
    backNoteClosed.value = true
  }

  /** The question was answered (either way): it is not asked again. */
  function resolveTimeOffer(): void {
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

  function setArchiveDone(value: boolean): void {
    archiveDone.value = value
  }

  return {
    lastShownDay, archiveDone, closedTaskIds, validClosedTaskIds, validLastShownDay, markShown, rememberClosed, setArchiveDone,
    lastNewDay, sentBack, firstBackDay, backNoteClosed, timeOffer, validLastNewDay, validSentBack, validFirstBackDay, validTimeOffer, markNewDay, closeBackNote, resolveTimeOffer,
  }
}, {
  persist: { key: 'day-recap-store', pick: ['lastShownDay', 'archiveDone', 'closedTaskIds', 'lastNewDay', 'sentBack', 'firstBackDay', 'backNoteClosed', 'timeOffer'] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDayRecapStore, import.meta.hot))
}
