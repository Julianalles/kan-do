/**
 * @composable useDayCloseAction
 * @description The one action of the day-close stage (#98, #480): "Tag abschließen". Only the stage calls it (the palette, the
 * menu and the app bar just open the stage through `useDayClose`), so none of them resolves the sync path.
 * @responsibility `finishDay()`, once per open stage and on the user's explicit click:
 * - today's done tasks and the earlier unacknowledged ones are archived through the shared archive path after the Erledigt
 *   list's short fade (#292, `DONE_LEAVE_MS`, none under reduced motion) and remembered for the next morning's recap;
 * - every unfinished task leaves today's board for "Alle" through the shared take-off (`useTakeOffBoard`, the fresh start's own
 *   code: Jetzt stops its timer and goes through Offen, Wartet goes through Offen, Offen and Jetzt form the group; a source
 *   that stores planning gets its "not planned" status written now). Nothing is deleted; time, notes and the board day count
 *   stay (the cards were on the board today: `takeBackCarryOver` stays the fresh start's);
 * - the next local day is marked as started with the group (`dayRecap.markDayClosed`), so the next morning has no notice and no
 *   second fresh start and shows the first half of the panel "Zuletzt geplant und nicht erledigt" that one day.
 * A second call finds the stage closed and does nothing; while the data file blocks writes (ADR 011) it does nothing either.
 * Resolve it in a component's setup: it holds the Nuxt-bound move path.
 */
import { nextTick } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useDayClose, focusBoard } from '~/composables/useDayClose'
import { useArchiveDoneTasks } from '~/composables/useArchiveDoneTasks'
import { useTakeOffBoard } from '~/composables/useTakeOffBoard'
import { syncToday } from '~/composables/useToday'
import { dataState } from '~/lib/dataStorage'
import { nextDayKey } from '~/utils/recapDay'

/** How long the Erledigt list fades before its tasks are archived (#292): `--duration-base`, mirrored here. */
export const DONE_LEAVE_MS = 200

/** Desktop only: nothing is written while the data file is in conflict or unavailable. */
export const dayCloseBlocked = (): boolean => dataState.available && dataState.status !== 'ok'

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useDayCloseAction() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const recapStore = useDayRecapStore()
  const dayClose = useDayClose()
  const { archiveTasks: archivePath } = useArchiveDoneTasks()
  const { takeOffBoard } = useTakeOffBoard()

  /** The shared archive path, remembered for the next morning's recap. */
  function archiveTasks(ids: string[]): void {
    recapStore.rememberClosed(ids)
    archivePath(ids)
  }

  /**
   * Erledigt ends the day empty (#292): today's done tasks and the not yet acknowledged earlier ones go through the one archive
   * path ("Gesehen" uses it too; nothing is deleted). The list fades first (`board.doneLeaving`), then what is still done is
   * archived. A call inside the fade does nothing, so a double click archives once.
   */
  function archiveDone(): void {
    if (boardStore.doneLeaving) return
    const done = () => new Set([...tasksStore.tasksDoneToday, ...tasksStore.tasksDonePrevious].map(task => task.id))
    const ids = [...done()]
    if (ids.length === 0) return
    if (prefersReducedMotion() || typeof window === 'undefined') {
      archiveTasks(ids)
      return
    }
    boardStore.doneLeaving = true
    window.setTimeout(async () => {
      const stillDone = done()
      boardStore.doneLeaving = false
      archiveTasks(ids.filter(id => stillDone.has(id)))
      // the CTA leaves with the next render: look at focus only then
      await nextTick()
      focusBoardIfLost()
    }, DONE_LEAVE_MS)
  }

  /** The CTA that held focus leaves with the tasks: focus goes to the board, never to <body>. */
  function focusBoardIfLost(): void {
    if (typeof document === 'undefined') return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    focusBoard()
  }

  /**
   * "Tag abschließen". Synchronous: every local change has happened when it returns; only the writes to the tasks' connections
   * run on.
   * @returns whether the day was closed (false: the stage was not open, or writes are blocked)
   */
  function finishDay(now: Date = new Date()): boolean {
    if (!dayClose.isOpen.value || dayCloseBlocked()) return false
    syncToday()
    // The sheet keeps the day it showed while the board empties beneath the curtain
    dayClose.freeze()
    dayClose.close()
    archiveDone()
    const { group, fromWaiting } = takeOffBoard()
    recapStore.markDayClosed(nextDayKey(now), group, fromWaiting)
    return true
  }

  return { finishDay }
}
