/**
 * @composable useNewDay
 * @description A new day starts fresh only when the user says so (#387; it replaces the automatic pass of #356):
 * the app never takes a card off the board and never writes to a connection by itself. The fresh start takes what
 * was planned and not finished (Jetzt, Offen and Wartet) off the board, onto "Alle Aufgaben"; skipping it keeps
 * yesterday's board as it is. Module-level state, so the page, the notice, the recap and the board share it.
 * @responsibility
 * - `check()`: the day check, called by `pages/tasks.vue` on the app's start (the first board mount of a page load)
 *   and on a return to the app after an absence (`lib/appPresence`), never on a route change and never while the user
 *   works in the window (#356 D5). It moves no card. It notes that today has begun in this window (`isDayBegun`: the
 *   notice, the recap and the page wait for it), writes the baseline of a board without a marker (today, or the day
 *   of the recap's marker when that is an earlier day: data from before #356, so the day stays due whatever the recap
 *   does to its own marker), counts a due day
 *   whose board has nothing unfinished as started, and turns the time a Jetzt timer counted after midnight while the
 *   user was away into the question of that day (`timeOffer`) without stopping the timer. Does nothing while the
 *   board is not onboarded, the desktop data status blocks writes (ADR 011) or the day-close dialog is open.
 * - `freshStart()`: the user's click ("Neuen Tag planen" in the recap, the notice's button). Once per local day (the
 *   marker `dayRecap.lastNewDay` is monotonic: a second click and a clock set back move nothing). The Jetzt task
 *   stops its timer and goes to Offen through the shared move path; the Wartet tasks stay Wartet (#794), then
 *   everything is taken off the board in one store action through `useTaskSync.unplanTasks`, which writes the "not
 *   planned" status of an Offen task to a source that stores planning (Notion with such a status mapped, #357); a Wartet
 *   task, Local, Todoist and Reminders get no planning write. Demo tasks stay. That take-off is
 *   `useTakeOffBoard().takeOffBoard()`, shared with the day close (#480), which does the same in the evening and marks
 *   the next day as started (`markDayClosed`): the morning after a close is not due, so it shows no notice and starts nothing. Nothing is deleted;
 *   title, notes, topic, priority, time box, time spent and source are untouched. The board day counted for today is
 *   taken back for the cards it takes off (`tasksStore.takeBackCarryOver`), so today counts only for what is planned
 *   again. It removes no time.
 * - The fresh start also arms the day's one slow move (#433, `armGlide`): the first move to Heute after it glides.
 * - `isNewDayDue()`: a local day has passed since the last fresh start (or, before the first one, since the recap's
 *   marker), i.e. today has not been started fresh.
 * - `groupIds`: the Jetzt and Offen tasks of today's fresh start that are still not planned, i.e. the first half of
 *   the panel "Zuletzt geplant und nicht erledigt"; it ends with its day without a write. `waitingIds`: the Wartet tasks that
 *   same start took off today, still waiting (`sentBack.waiting`), the panel's second half, ending with its day too (#469); an
 *   earlier start's Wartet task is a plain "Weitere Aufgaben" task.
 * - `blockDay` (#741): how the block of those two lists names the day its tasks are from ("Von gestern", "Von Samstag",
 *   "Vom 14. November"), from `sentBack.from`: the fresh start stores the day the board was last planned (the marker it
 *   replaces), the day close its own day; without one it reads "yesterday".
 * - `noticeShown` / `closeNotice()`: the notice that offers the fresh start, on a day that has begun in this window,
 *   has not been started fresh, whose notice was not closed, while something unfinished is on the board.
 * - `planNoteShown` / `armPlanNote()` / `answerPlanNote()` (#711): the one-time note on "Alle" about what the step is for. `freshStart()` (the
 *   notice's button) and `armPlanNote()` (the recap's button, also when there is nothing to start) arm the runtime signal
 *   `planArrival` (`lib/dayBegun`); neither "Überspringen
 *   und Board anzeigen", the pill, a deep link, a reload nor the day close does. It is shown until `answerPlanNote()` writes the persisted
 *   `dayRecap.planNoteSeen`: once per user, never again, also after a restart.
 * - `timeOffer` / `takeOffTime()` / `keepTime()`: the question "the timer ran on for {duration} after midnight: take
 *   that time off, or keep it?" for that one day. Unanswered the time stays (keep is the default) and the question
 *   ends with its day; taking it off lowers the task's time (also of a timer that still runs), cuts the Statistik
 *   work sessions and reaches a connection that stores time, never below zero, exactly once. Only the away time
 *   between the last midnight and the day check is offered (#356 D3 b, #387 D1 g).
 */
import { computed } from 'vue'
import { syncToday, useToday } from '~/composables/useToday'
import { useTasksStore, type AfterMidnightCount } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useDayClose } from '~/composables/useDayClose'
import { useTakeOffBoard } from '~/composables/useTakeOffBoard'
import { checkpointTaskTimer } from '~/composables/useTaskTimerDriver'
import { cutWorkSessions } from '~/composables/useWorkSessionTracking'
import { dataState } from '~/lib/dataStorage'
import { armGlide } from '~/lib/boardPlace'
import { isDemoTaskId } from '~/lib/demoIds'
import { isNotPlanned } from '~/lib/taskPlanning'
import { blockWhen, dayKey } from '~/utils/recapDay'
import { begunDay, dueOn, planArrival, resetNewDay } from '~/lib/dayBegun'

export { resetNewDay }

/** The question is asked for a stretch of at least a minute: a shorter one is not worth asking about. */
export const TIME_OFFER_MIN_SECONDS = 60

/** Desktop only: nothing is written while the data file is in conflict or unavailable. */
const writesBlocked = () => dataState.available && dataState.status !== 'ok'

/**
 * Whether a day has passed since the last fresh start (or, before the first one, since the recap's marker): today
 * has not been started fresh. A one-off read for callers outside a component; `now` is injectable for tests.
 */
export function isNewDayDue(now: Date = new Date()): boolean {
  return dueOn(dayKey(now))
}

export function useNewDay() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const recapStore = useDayRecapStore()
  const { today } = useToday()
  // Resolved here, in the caller's setup: the check also runs from a window event (the return to the app), where
  // the Nuxt helpers these need (the toast) are out of reach
  const { takeOffBoard, unfinished: unfinishedOnBoard } = useTakeOffBoard()
  const dayClose = useDayClose()

  /** What a fresh start would take off the board: Jetzt, Offen and Wartet without the demo tasks, in that order. */
  const unfinished = computed(() => unfinishedOnBoard())

  /**
   * The time a Jetzt timer counted after the local midnight that starts `todayKey` while the user was away becomes
   * the question of that day. The timer is not stopped (#387: on a skipped day it keeps tracking); what it has
   * collected is written first, so the store holds everything it counted. The note is dropped whatever it held: one
   * for a task that is no longer in Jetzt, or for an earlier midnight, is never used later. The day is settled with
   * it: a tick that sees this midnight only after the check (the machine slept across it and the wake-up's focus
   * event came first) starts no note, so a later absence that day is never asked about (D1 g).
   */
  function askAboutNight(todayKey: string): void {
    let offer: AfterMidnightCount | null = null
    for (const task of tasksStore.tasksProgress) {
      if (isDemoTaskId(task.id)) continue
      checkpointTaskTimer(task.id)
      const counted = tasksStore.takeAfterMidnight(task.id, todayKey)
      if (counted && counted.seconds >= TIME_OFFER_MIN_SECONDS) offer = counted
    }
    tasksStore.settleAfterMidnight(todayKey)
    if (offer) recapStore.offerTime(offer)
  }

  /**
   * The day check: the app was opened or returned to after an absence. Moves no card and writes to no connection.
   * @returns whether the check ran (false while the board is not onboarded, writes are blocked or the day close is open)
   */
  function check(now: Date = new Date()): boolean {
    syncToday()
    if (boardStore.boardConfig.sources === null) return false
    if (writesBlocked()) return false
    // The evening's dialog is still open: the day does not begin under it; the next return checks again
    if (dayClose.isOpen.value) return false

    const todayKey = dayKey(now)
    // A question of an earlier day was never answered: the time stayed, the question is gone
    const pending = recapStore.validTimeOffer
    if (pending && pending.day < todayKey) recapStore.resolveTimeOffer()
    askAboutNight(todayKey)
    const due = isNewDayDue(now)
    if (recapStore.validLastNewDay === null) {
      // No marker yet: the baseline is written here, once. Without proof of an earlier day (a new board, or the
      // update arrived during the day) it is today, and the first day that can be started fresh is tomorrow. Data
      // from before the fresh start existed whose recap marker is an earlier day gets that day: today stays a day to
      // start fresh by a marker of its own, because leaving the recap moves the recap's marker to today before
      // "Neuen Tag planen" runs, and "Direkt zum Board" moves it before the notice looks
      recapStore.markNewDay(due ? recapStore.validLastShownDay ?? todayKey : todayKey, [])
    }
    if (due && unfinished.value.length === 0) {
      // Nothing of yesterday is on the board: the day is started as it is, and what the user plans from here on is
      // today's plan, which no notice may call yesterday's
      recapStore.markNewDay(todayKey, [])
    }
    begunDay.value = todayKey
    return true
  }

  /** Whether the day check of the current local day ran in this window: the recap and the notice wait for it. */
  function isDayBegun(now: Date = new Date()): boolean {
    return begunDay.value === dayKey(now)
  }

  /**
   * The fresh start, on the user's click. Synchronous: every local change has happened when it returns; only the
   * writes to the tasks' connections run on.
   * @returns the ids taken off the board (empty when it was refused, already ran today or the board had nothing)
   */
  function freshStart(now: Date = new Date()): string[] {
    syncToday()
    if (boardStore.boardConfig.sources === null) return []
    if (writesBlocked()) return []
    if (dayClose.isOpen.value) return []
    // Once per local day: a second click, a stale button or a clock set back moves nothing
    if (!isNewDayDue(now)) return []

    const todayKey = dayKey(now)
    // The user chose this step: "Alle" may tell them once what it is for (#711)
    planArrival.value = true
    // A check always comes first in the app; a caller without one still loses no question
    askAboutNight(todayKey)

    // The shared take-off (also the day close's): Jetzt through Offen, Wartet as it is, then off the board
    const { group, sent, fromWaiting } = takeOffBoard()
    // The Wartet ones are this day's too (#469): the panel names them from `sentBack`, so it ends with the day
    recapStore.markNewDay(todayKey, group, fromWaiting)
    // The cards were on the board this morning and counted the day: only what is planned again counts it
    tasksStore.takeBackCarryOver(sent, todayKey)
    // The first move to Heute after this start is the day's one slow move (#433)
    armGlide(todayKey)
    return sent
  }

  /** Today's fresh start, null on any other day (the shared "today" is reactive across midnight and on return). */
  const todaysBack = computed(() => {
    const sentBack = recapStore.validSentBack
    return sentBack && sentBack.day === dayKey(today.value) ? sentBack : null
  })

  /**
   * How the block on "Alle" names the day its tasks are from (#741): "yesterday", a weekday or a date. Read from today's
   * `sentBack.from`; without one (older data, nothing taken off) it reads "yesterday".
   */
  const blockDay = computed(() => blockWhen(todaysBack.value?.from, dayKey(today.value)))

  /** The ids of the tasks that are held as not planned now. */
  const heldIds = computed(() => new Set(tasksStore.tasks.filter(task => isNotPlanned(task)).map(task => task.id)))

  /** The group "Zuletzt geplant und nicht erledigt": today's Jetzt and Offen tasks that are still not planned, in their order. */
  const groupIds = computed<string[]>(() => {
    const ids = todaysBack.value?.ids ?? []
    return ids.length === 0 ? ids : ids.filter(id => heldIds.value.has(id))
  })

  /**
   * The second half of the panel (#469): the tasks today's fresh start (or the evening's day close) took off today from Wartet (they stay Wartet) that
   * are still not planned, in their order. A Wartet task of an earlier start is a plain "Weitere Aufgaben" task: the panel
   * ends with its day, like `groupIds`. Stored data without `waiting` (before #469) lists none.
   */
  const waitingIds = computed<string[]>(() => {
    const ids = todaysBack.value?.waiting ?? []
    if (ids.length === 0) return ids
    const inGroup = new Set(groupIds.value)
    return ids.filter(id => heldIds.value.has(id) && !inGroup.has(id))
  })

  /**
   * The notice that offers the fresh start: today has begun in this window and was not started fresh, the notice was
   * not closed today, and something unfinished is on the board.
   */
  const noticeShown = computed(() => {
    const todayKey = dayKey(today.value)
    return begunDay.value === todayKey && dueOn(todayKey) && recapStore.validNoticeClosedDay !== todayKey && unfinished.value.length > 0
  })

  /** "Schließen": the notice stays away for today; the board stays as it is. */
  function closeNotice(): void {
    if (writesBlocked()) return
    recapStore.closeNotice(dayKey(today.value))
  }

  /**
   * The one-time note on "Alle" (#711): the user arrived through "Neuen Tag planen" in this window and has not answered it yet
   * (closed it, or gone on to "Heute"), in this life of the app or an earlier one. Whether "Alle" shows is the caller's.
   */
  const planNoteShown = computed(() => planArrival.value && !recapStore.validPlanNoteSeen)

  /**
   * The user chose "Neuen Tag planen" without `freshStart()` having anything to start (the recap's button on a board with nothing
   * unfinished: the day check already counted it as started): the note still tells them what "Alle" is for.
   */
  function armPlanNote(): void {
    planArrival.value = true
  }

  /**
   * The note is answered ("Schließen", or the user went on to "Heute"): it never comes back. While the data status blocks writes
   * (ADR 011) nothing is stored: the note is gone for this window only.
   */
  function answerPlanNote(): void {
    planArrival.value = false
    if (writesBlocked()) return
    recapStore.markPlanNoteSeen()
  }

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
    // The sessions follow the question, not the clamp: the stretch was counted away from the window either way.
    // Through the tracker: the task's timer may still run (a day that was not started fresh), so its open session moves
    if (offer.spans.length > 0) cutWorkSessions(offer.spans)
    return removed
  }

  /** "Zeit behalten": the time stays as recorded; the question is not asked again. */
  function keepTime(): void {
    if (writesBlocked()) return
    recapStore.resolveTimeOffer()
  }

  return { check, isDayBegun, freshStart, groupIds, waitingIds, blockDay, noticeShown, closeNotice, planNoteShown, armPlanNote, answerPlanNote, timeOffer, takeOffTime, keepTime }
}
