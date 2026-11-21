/**
 * @composable usePlanAll
 * @description "Alle für heute einplanen" on a yesterday panel of "Alle" (#702): plans every task of the panel for today,
 * each as if the user had picked it singly, and says so in one toast with "Rückgängig".
 * @responsibility
 * - `planAll(ids)`: one `usePlanMoves().planForToday` per id, at the same time (each card keeps its own motion and the
 *   single pick's writes, status and date, per task; no new write path). A task that could not move (a second request for a
 *   card that is still leaving, a task that is gone) is left out. Resolves to the ids that moved.
 * - The toast counts the tasks that moved ("n Aufgaben sind für heute geplant.") and offers "Rückgängig" for 6 s. Undo
 *   restores a planned date first (a source that plans by date) and then puts exactly those tasks back, each one that is
 *   still planned; they return to their panel because the panel is derived from `useNewDay`, not stored.
 * - Nothing runs on its own: the caller is the user's click.
 */
import { usePlanMoves } from '~/composables/usePlanMoves'
import { PLAN_TOAST_MS } from '~/composables/usePlanToasts'
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { isNotPlanned } from '~/lib/taskPlanning'
import { translate } from '~/lib/i18n'
import { ICONS } from '~/lib/icons'
import { useToast } from '#imports'

export function usePlanAll() {
  const { planForToday } = usePlanMoves()
  const { restorePlannedDate, unplanTask } = useTaskSync()
  const tasksStore = useTasksStore()
  const toast = useToast()

  async function undo(ids: readonly string[], toastId: string): Promise<void> {
    toast.remove(toastId)
    for (const id of ids) {
      const task = tasksStore.task(id)
      if (!task || isNotPlanned(task)) continue
      if (await restorePlannedDate(id)) unplanTask(id)
    }
  }

  async function planAll(ids: readonly string[]): Promise<string[]> {
    const results = await Promise.all(ids.map(async id => ((await planForToday(id)) ? id : null)))
    const done = results.filter((id): id is string => id !== null)
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
