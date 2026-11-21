/**
 * @module lib/dayBegun
 * @description Whether today has begun in this window (#387, #553): the day check ran (`useNewDay().check()`) and the day is
 * either started fresh or skipped, with the recap closed. A source that plans by date (Apple Reminders) lets a task dated
 * today join the board only then, never in the middle of the recap or before the user decided about yesterday's board.
 * Module-level state shared by `useNewDay` and the task source registry; a module of its own because `useNewDay` imports
 * `useTaskSync`, which imports the registry (the adapter reads `dayHasBegun` through a dep).
 */
import { ref } from 'vue'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { recapIsOpen } from '~/lib/recapOpenState'
import { dayKey } from '~/utils/recapDay'

/**
 * The local day whose check ran in this window (runtime only: a reload is an app start and checks again). The
 * notice and the recap of a new day wait for it, so neither appears under the hands of someone working across
 * midnight.
 */
export const begunDay = ref<string | null>(null)

/**
 * The user chose "Tag neu planen" in this window (#711): armed by `useNewDay().freshStart()` (the notice's button) or `armPlanNote()` (the recap's button), so the one-time note on "Alle" knows
 * the user arrived through that step. Runtime only: a reload, the pill, a deep link and "Überspringen und Board anzeigen" never
 * arm it. Cleared when the note is answered.
 */
export const planArrival = ref(false)

/** Test seam: a fresh app start. */
export function resetNewDay(): void {
  begunDay.value = null
  planArrival.value = false
}

/** Whether `today` (a day key) is a day after the last fresh start, or after the recap's marker before the first one. */
export function dueOn(today: string): boolean {
  if (useBoardStore().boardConfig.sources === null) return false
  const recapStore = useDayRecapStore()
  const marker = recapStore.validLastNewDay
  if (marker !== null) return marker < today
  const lastShown = recapStore.validLastShownDay
  return lastShown !== null && lastShown < today
}

/**
 * Whether today has begun: the check ran for this local day, and the day is started fresh (not due) or skipped (the
 * notice that offers the fresh start was closed today), and the recap is closed. Reactive (reads refs and store state), pure
 * otherwise; `now` is injectable for tests.
 */
export function dayHasBegun(now: Date = new Date()): boolean {
  const todayKey = dayKey(now)
  if (begunDay.value !== todayKey || recapIsOpen.value) return false
  return !dueOn(todayKey) || useDayRecapStore().validNoticeClosedDay === todayKey
}
