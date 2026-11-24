/**
 * @composable usePlanAll
 * @description "Alle für heute einplanen" on a yesterday panel of "Alle" (#702): plans every task of the panel for today,
 * each as if the user had picked it singly, and says so in one toast with "Rückgängig".
 * @responsibility
 * - `planAll(ids)`: `usePlanMoves().planMany`, i.e. one `useTaskSync.planTasks` (the single pick's writes, status and
 *   date, per task, one after another in the order given; no new write path) with each card's own motion. A source that
 *   plans by date raises no toast per task: this toast is the only one, and its "Rückgängig" restores the dates. A task
 *   that could not move (a card that is still leaving, a task that is gone) is left out. Resolves to the ids that moved.
 * - The toast counts the tasks that moved ("n Aufgaben sind für heute geplant.") and offers "Rückgängig" for 6 s. Undo
 *   waits for the plan's writes still running, restores a planned date (a source that plans by date), one task after another, and then puts exactly those
 *   tasks back in one `unplanTasks` (so "Alle" keeps the order of a put-back), each one still planned in Offen (a task
 *   moved on to Jetzt or Wartet meanwhile keeps its date); they return to their panel because the panel is derived from
 *   `useNewDay`, not stored.
 * - Nothing runs on its own: the caller is the user's click.
 */
import { usePlanMoves } from '~/composables/usePlanMoves'
import { PLAN_TOAST_MS } from '~/composables/usePlanToasts'
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { canBeOffToday, isNotPlanned } from '~/lib/taskPlanning'
import { translate } from '~/lib/i18n'
import { ICONS } from '~/lib/icons'
import { useToast } from '#imports'

export function usePlanAll() {
  const { planMany } = usePlanMoves()
  const { restorePlannedDate, unplanTasks, whenPlanWritten } = useTaskSync()
  const tasksStore = useTasksStore()
  const toast = useToast()

  async function undo(ids: readonly string[], toastId: string): Promise<void> {
    toast.remove(toastId)
    // The plan's write loop may still be running for the later tasks (a write already started cannot be stopped, one
    // not started would run after the restore and write today's date again): wait for it, as the single put-back does
    await Promise.all(ids.map(whenPlanWritten))
    const back: string[] = []
    // One after another: the date writes go to the source in the order planned
    for (const id of ids) {
      const task = tasksStore.task(id)
      // Still planned and still in Offen or Wartet (#793): a task moved on since keeps its date, as it keeps its place
      if (!task || !canBeOffToday(task.status) || isNotPlanned(task)) continue
      if (await restorePlannedDate(id)) back.push(id)
    }
    // A task moved on while the dates were restored is refused by `unplanTasks` itself
    unplanTasks(back)
  }

  async function planAll(ids: readonly string[]): Promise<string[]> {
    const done = await planMany(ids)
    if (done.length === 0) return done
    const toastId = `plan-all-${Date.now()}`
    toast.add({
      id: toastId,
      title: translate('board.notPlanned.plannedMany', { n: done.length }, done.length),
      icon: ICONS.dueToday,
      color: 'neutral',
      duration: PLAN_TOAST_MS,
      actions: [{
        label: translate('common.undo'),
        color: 'neutral',
        variant: 'soft',
        closeOnClick: false,
        onClick: () => { void undo(done, toastId) },
      }],
    })
    return done
  }

  return { planAll }
}
