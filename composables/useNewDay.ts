/**
 * @composable useNewDay
 * @description A new day sends what was planned and not finished back to "Meine Aufgaben" (#356, epic #334): one
 * pass per local day over Jetzt and Offen, run when the app is opened or returned to after an absence on a later
 * day (never while the user works in the window: not at midnight, not on a route change), with or without a recap. It changes kan-do's own state only (also for a connection that stores planning, #357: the pass is `unplanTasks(..., { local: true })`), except for
 * the one Jetzt task, whose status is written to its connection like the day close's "Fertig" does.
 * @responsibility
 * - `run()`: called by `pages/tasks.vue` before the recap's check, on the app's start (the first board mount of a
 *   page load) and on a return to the app (window focus, tab visible) after an absence (`lib/appPresence`); never
 *   on a route change. Does nothing while the board is not onboarded, the desktop data status blocks writes (ADR 011)
 *   or the day-close dialog is open, and nothing when its marker (`dayRecap.lastNewDay`) is today or later (a clock
 *   set back never repeats it). Without a marker the pass runs only when the recap's marker proves an earlier day
 *   (an existing board on its first morning after the update); otherwise today is the baseline and nothing moves.
 * - The pass: the Jetzt task stops its timer and moves to Offen through the shared move path; then Jetzt and Offen
 *   (board order, Jetzt first, demo tasks excluded) are taken off the board in one store action and stand on top of
 *   "Meine Aufgaben". Wartet and Erledigt stay. Nothing is deleted; title, notes, topic, priority, time box, source and
 *   the carried-over entry are untouched. It removes NO time by itself (the user's decision of 2026-11-16: nothing is
 *   removed silently): the time its timer counted after the local midnight that starts today while the user was away
 *   from the window (`tasksStore.takeAfterMidnight`, D3 o) becomes a question (`timeOffer`).
 * - `isNewDayDue()`: the pass has not run today although a day has passed; the carried-over count waits for it, so a
 *   day only counts as planned for what the user plans after the pass.
 * - `groupIds`: the ids of today's pass that are still not planned, i.e. the group "Gestern geplant, noch offen";
 *   it ends with its day without a write.
 * - `timeOffer` / `takeOffTime()` / `keepTime()`: the question "the timer ran on for {duration} after midnight: take
 *   that time off, or keep it?" for that one day. Unanswered the time stays (keep is the default) and the question
 *   ends with its day; taking it off does what the removal used to do (the task's time, the Statistik work
 *   sessions, a connection that stores time), never below zero, exactly once. Only the time after the last midnight
 *   is offered (D3 b).
 * - `noteShown` / `planAllAgain()` / `closeNote()`: the one-time note of the first pass that ever sent a card
 *   back (D2, point 1a) and its button "Alle wieder einplanen", which plans the whole group again, this once.
 */
import { computed } from 'vue'
import { syncToday, useToday } from '~/composables/useToday'
import { useTasksStore, type AfterMidnightCount } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useDayClose } from '~/composables/useDayClose'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskSync } from '~/composables/useTaskSync'
import { resumeTaskTimer, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { dataState } from '~/lib/dataStorage'
import { isDemoTaskId } from '~/lib/demoIds'
import { isNotPlanned } from '~/lib/taskPlanning'
import { dayKey } from '~/utils/recapDay'
import { TaskStatus } from '~/types/taskStatus'

/** The question is asked for a stretch of at least a minute: a shorter one is not worth asking about. */
export const TIME_OFFER_MIN_SECONDS = 60

/** Desktop only: nothing is written while the data file is in conflict or unavailable. */
const writesBlocked = () => dataState.available && dataState.status !== 'ok'

/**
 * Whether a day has passed since the last pass (or, before the first one, since the recap's marker). A one-off
 * read for callers outside a component; `now` is injectable for tests.
 */
export function isNewDayDue(now: Date = new Date()): boolean {
  if (useBoardStore().boardConfig.sources === null) return false
  const recapStore = useDayRecapStore()
  const today = dayKey(now)
  const marker = recapStore.validLastNewDay
  if (marker !== null) return marker < today
  const lastShown = recapStore.validLastShownDay
  return lastShown !== null && lastShown < today
}

export function useNewDay() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const recapStore = useDayRecapStore()
  const { today } = useToday()
  // Resolved here, in the caller's setup: the pass also runs from a window event (the return to the app), where
  // the Nuxt helpers these need (the toast) are out of reach
  const { moveTaskToStatus } = useTaskOperations()
  const { planTasks, unplanTasks } = useTaskSync()
  const dayClose = useDayClose()

  /**
   * Runs the pass when it is due. Synchronous: every local change has happened when it returns; only the Jetzt
   * task's write to its connection runs on.
   * @returns the ids sent back (empty when nothing ran or nothing was on the board)
   */
  function run(now: Date = new Date()): string[] {
    syncToday()
    if (boardStore.boardConfig.sources === null) return []
    if (writesBlocked()) return []
    // The evening's dialog is still open: its list must not empty under the user's hands; the next return runs the pass
    if (dayClose.isOpen.value) return []

    const todayKey = dayKey(now)
    if (!isNewDayDue(now)) {
      // No marker and no proof of an earlier day (a new board, or the update arrived during the day): today is
      // the baseline, the first pass is tomorrow's
      if (recapStore.validLastNewDay === null) recapStore.markNewDay(todayKey, [])
      return []
    }

    const back: string[] = []
    let offer: AfterMidnightCount | null = null
    for (const task of tasksStore.tasksProgress.filter(task => !isDemoTaskId(task.id))) {
      const { id } = task
      // The stop writes the collected seconds first, so the store holds everything the timer counted
      stopTaskTimer(id)
      // Nothing is removed: the stretch counted after midnight while the user was away becomes a question
      const counted = tasksStore.takeAfterMidnight(id, todayKey)
      if (counted && counted.seconds >= TIME_OFFER_MIN_SECONDS) offer = counted
      // Local change at once (status, board order); the write to the task's connection follows on its own
      void moveTaskToStatus(id, TaskStatus.Open).catch(() => {})
      if (tasksStore.task(id)?.status === TaskStatus.Open) back.push(id)
      // A refused move leaves the task in Jetzt: it keeps counting, as after a refused day close
      else resumeTaskTimer(id)
    }
    // A note for a task that is no longer in Jetzt (or for an earlier midnight) is never used later
    tasksStore.clearAfterMidnight()
    for (const task of tasksStore.tasksOpen) {
      if (!isDemoTaskId(task.id) && !back.includes(task.id)) back.push(task.id)
    }

    // kan-do's own state only: the morning writes nothing to a connection for the cards it sends back (#357, D1)
    const sent = unplanTasks(back, { local: true })
    recapStore.markNewDay(todayKey, sent, offer)
    return sent
  }

  /** Today's pass result, null on any other day (the shared "today" is reactive across midnight and on return). */
  const todaysBack = computed(() => {
    const sentBack = recapStore.validSentBack
    return sentBack && sentBack.day === dayKey(today.value) ? sentBack : null
  })

  /** The group "Gestern geplant, noch offen": today's sent-back tasks that are still not planned, in their order. */
  const groupIds = computed<string[]>(() => {
    const ids = todaysBack.value?.ids ?? []
    if (ids.length === 0) return ids
    const held = new Set(tasksStore.tasks.filter(task => isNotPlanned(task)).map(task => task.id))
    return ids.filter(id => held.has(id))
  })

  /** The open question about the time after midnight: today's offer for a task that still exists, else null. */
  const timeOffer = computed(() => {
    const offer = recapStore.validTimeOffer
    if (!offer || offer.day !== dayKey(today.value)) return null
    const task = tasksStore.task(offer.taskId)
    return task ? { taskId: offer.taskId, title: task.title, seconds: Math.floor(offer.seconds) } : null
  })

  /**
   * "Zeit abziehen": takes the offered seconds off the task again and cuts the same stretch out of the Statistik
   * work sessions. The offer is cleared first, so it can happen once only.
   * @returns the seconds taken off (0 when there was no offer, writes are blocked or the task holds no time)
   */
  function takeOffTime(): number {
    if (writesBlocked()) return 0
    const offer = recapStore.validTimeOffer
    const open = timeOffer.value
    if (!offer || !open) return 0
    recapStore.resolveTimeOffer()
    const removed = tasksStore.takeOffSeconds(offer.taskId, offer.seconds)
    // The sessions follow the question, not the clamp: the stretch was counted away from the window either way
    if (offer.spans.length > 0) useTaskStatisticsStore().cutWorkSessions(offer.spans)
    return removed
  }

  /** "Zeit behalten": the time stays as recorded; the question is not asked again. */
  function keepTime(): void {
    if (writesBlocked()) return
    recapStore.resolveTimeOffer()
  }

  /** The one-time note: on the day of the first pass that sent cards back, until closed, while its group has a task. */
  const noteShown = computed(() =>
    !recapStore.backNoteClosed && todaysBack.value !== null && recapStore.validFirstBackDay === todaysBack.value.day && groupIds.value.length > 0)

  /** "Alle wieder einplanen": the whole group lands at the end of Offen in its order; the note is done. */
  function planAllAgain(): string[] {
    if (writesBlocked()) return []
    const planned = planTasks(groupIds.value)
    recapStore.closeBackNote()
    return planned
  }

  function closeNote(): void {
    if (writesBlocked()) return
    recapStore.closeBackNote()
  }

  return { run, groupIds, noteShown, planAllAgain, closeNote, timeOffer, takeOffTime, keepTime }
}
