/**
 * @composable useNewDayRecap
 * @description The "Tagesrückblick" on the first start of a new day (#385): decides whether the recap is due,
 * owns its open state and the snapshot it shows, and runs the one action when the user leaves it. State is
 * module-level so the page, the overlay and the board share it.
 * @responsibility
 * - `check(routeName)`: called by `pages/tasks.vue` in its setup (so a due recap is open for the first render, #427), on a return to the app after an absence (`listenForReturn`:
 *   window focus, tab visible; #242) and on a route change, never awaited. The page runs the day check first
 *   (`useNewDay().check()`, only on the app's start and on such a return) and skips this check on a day that has not
 *   begun in this window, so the recap never opens under the hands of someone working across midnight. It syncs the
 *   shared "today" first. Opens the recap when the board is
 *   onboarded, the data status does not block writes, `lastShownDay` is a day before today and there are
 *   done-before-today tasks. A missing or malformed marker is the baseline: write today once, show nothing
 *   (skipped while the data status blocks, ADR 011). The day key is computed once here, so a midnight
 *   crossed while the window stays focused never opens it; the next return does.
 * - Tasks a day close archived (`dayRecap.closedTaskIds`, #292) count as done before today, so closing the day does not
 *   cancel the next morning's recap; the marker moving clears them.
 * - A day close of the evening before (#480) took its unfinished tasks off the board and marked today as started: the still-open deck lists them from `sentBack` (Jetzt, Offen in `ids`, the Wartet ones in `waiting`).
 * - The snapshot is a copy taken at open: a fetch landing later, and the fresh start "Neuen Tag planen" runs (#387), change
 *   nothing in the page. Its still-open deck is yesterday's board: what is on the board now, the recap opens before
 *   any fresh start; what a fresh start of today already took off (a board the automatic pass of #356 emptied this
 *   morning, before the update) is listed first.
 * - `leave({ archive })` (button, Escape, #428): archives the snapshot ids still done before today when `archive` is set, which only
 *   "Neuen Tag planen" does (the day's planning; shared path with the board button; no toast, no undo, #463). Skipping and Escape
 *   archive nothing: the done tasks stay in Erledigt under the "Gestern erledigt" note and its "Gesehen" hides them. Moves the
 *   marker to the day the recap opened on, closes.
 * - `recapOpen`: the open state as a module-level read-only ref, for the app bar (useAppNav): while it is true the pill shows
 *   Rückblick instead of Alle and Heute (#428). It needs no store, so the bar never instantiates one for it.
 * - `finishLeave()` after the fade-out: drops the snapshot and hands focus to the board, never to <body>.
 */
import { computed, readonly, ref } from 'vue'
import { syncToday } from '~/composables/useToday'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useDayClose } from '~/composables/useDayClose'
import { useArchiveDoneTasks } from '~/composables/useArchiveDoneTasks'
import { dataState } from '~/lib/dataStorage'
import { recapIsOpen } from '~/lib/recapOpenState'
import { newestCompletedAt } from '~/utils/doneDayLabel'
import { dayKey, isRecapDue, recapWhen, type RecapWhen } from '~/utils/recapDay'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

/** What the page shows; plain copies taken when the recap opens. */
export interface RecapSnapshot {
  /** Done before today, not archived; oldest completion first. */
  done: Task[]
  /** Jetzt, Offen, Wartet. */
  undone: Task[]
  when: RecapWhen
  /** Local day the recap opened on; becomes `lastShownDay` when it is left. */
  dayKey: string
}

const isOpen = recapIsOpen
const snapshot = ref<RecapSnapshot | null>(null)

/** The recap is open (#428): what the app bar reads to show Rückblick instead of Alle and Heute. */
export const recapOpen = readonly(isOpen)

/** Test seam: a fresh app start. */
export function resetNewDayRecap(): void {
  isOpen.value = false
  snapshot.value = null
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const completedTime = (task: Task) => new Date(task.completedAt ?? 0).getTime()
const copyTask = (task: Task): Task => ({ ...task, custom: task.custom ? { ...task.custom } : task.custom })

export function useNewDayRecap() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const recapStore = useDayRecapStore()
  const { archiveTasks } = useArchiveDoneTasks()
  const dayClose = useDayClose()

  /** Desktop only: nothing is written or archived while the data file is in conflict or unavailable. */
  const writesBlocked = () => dataState.available && dataState.status !== 'ok'

  /** Yesterday's unfinished tasks: what a fresh start of today took off the board and is still not done, then the board as it is. */
  function stillOpen(todayKey: string): Task[] {
    const sentBack = recapStore.validSentBack
    // Today's start took these off the board: the Jetzt and Offen group, then the Wartet ones it took off. A day close
    // of yesterday evening (#480) is such a start: the morning's recap still shows its unfinished tasks
    // the Wartet ones are the close's own (`sentBack.waiting`)
    const backIds = sentBack && sentBack.day === todayKey ? [...sentBack.ids, ...(sentBack.waiting ?? [])] : []
    const back = [...new Set(backIds)]
      .map(id => tasksStore.task(id))
      .filter((task): task is Task => !!task && task.status !== TaskStatus.Done)
    const seen = new Set(back.map(task => task.id))
    const onBoard = [...tasksStore.tasksProgress, ...tasksStore.tasksOpen, ...tasksStore.tasksWaiting].filter(task => !seen.has(task.id))
    return [...back, ...onBoard]
  }

  function check(routeName: unknown): void {
    // never modal on modal: an evening day-close dialog still open waits for the next return
    if (isOpen.value || routeName !== 'tasks' || dayClose.isOpen.value) return
    // the done-before-today list reads the shared "today": bring it up to date before looking at it (#242)
    syncToday()
    if (boardStore.boardConfig.sources === null) return
    if (writesBlocked()) return

    const now = new Date()
    const todayKey = dayKey(now)
    const lastShown = recapStore.validLastShownDay
    if (lastShown === null) {
      recapStore.markShown(todayKey)
      return
    }
    if (!isRecapDue(lastShown, todayKey)) return

    // what a day close archived still counts: the morning after it is the recap's whole point (#292)
    const previous = tasksStore.tasksDonePrevious
    const todayStart = startOfDay(now)
    const closedIds = recapStore.validClosedTaskIds
    const closed = tasksStore.tasks.filter(task => closedIds.includes(task.id)
      && task.status === TaskStatus.Done && task.completedAt && new Date(task.completedAt) < todayStart
      && !previous.some(p => p.id === task.id))
    const done = [...previous, ...closed].sort((a, b) => completedTime(a) - completedTime(b)).map(copyTask)
    if (done.length === 0) return
    const newest = newestCompletedAt(done)
    if (!newest) return

    snapshot.value = {
      done,
      undone: stillOpen(todayKey).map(copyTask),
      when: recapWhen(newest, now),
      dayKey: todayKey,
    }
    isOpen.value = true
  }

  /**
   * Runs `onReturn` (the page's day check: `useNewDay().check()`, then `check`) whenever the app is shown or focused again (#242): a hidden desktop window or a restored tab does not
   * remount the page, so the first return on a new day would otherwise wait for a click or navigation. A window that
   * stays focused across midnight is never interrupted. Returns the function that removes the listeners.
   */
  function listenForReturn(onReturn: () => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') onReturn()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }

  /** "Neuen Tag planen" (`archive`), "Überspringen und Board anzeigen" and Escape (no archive): only the planning archives the done tasks. */
  function leave({ archive = false }: { archive?: boolean } = {}): void {
    const current = snapshot.value
    if (!isOpen.value || !current) return
    // The data file went into conflict or became unavailable while the recap was open: close, write nothing
    if (writesBlocked()) {
      isOpen.value = false
      return
    }
    // A fetch may have reopened or deleted one since the snapshot: only what is still done before today goes
    const stillDone = new Set(tasksStore.tasksDonePrevious.map(task => task.id))
    const ids = archive ? current.done.map(task => task.id).filter(id => stillDone.has(id)) : []
    recapStore.markShown(current.dayKey)
    isOpen.value = false
    archiveTasks(ids)
  }

  /** After the leave transition: the page no longer needs its snapshot; focus goes to the board region. */
  function finishLeave(options: { restoreFocus?: boolean } = {}): void {
    snapshot.value = null
    if (options.restoreFocus !== false) restoreFocus()
  }

  function restoreFocus(): void {
    if (typeof document === 'undefined') return
    const board = document.querySelector<HTMLElement>('[data-task-sheet-return]')
    if (!board) return
    board.setAttribute('tabindex', '-1')
    board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true })
    board.focus({ preventScroll: true })
  }

  return { isOpen: readonly(isOpen), snapshot: computed(() => snapshot.value), check, listenForReturn, leave, finishLeave }
}
