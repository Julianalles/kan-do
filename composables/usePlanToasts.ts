/**
 * @composable usePlanToasts
 * @description The toasts of a task whose source plans by date (Apple Reminders, #553, epic #481): what planning a task for
 * today did to its reminder, and what a put-back left behind. The state change is `useTaskSync.planTask` / `unplanTask`
 * (called by `usePlanMoves` and the board's drag); this raises the toast around them and owns the two undo paths:
 * "Rückgängig" on the plan toast (the date goes back, the task goes back) and "Altes Datum zurück: {date}" on the
 * put-back toast (the date only).
 * @responsibility
 * - `afterPlan(id)`: waits until the plan's write answered, then toasts what Reminders holds now (the old date, "ohne
 *   Uhrzeit"), or that a recurring reminder's date stays. Nothing when no date was written and none is held back.
 * - `afterPutBack(id)`: waits for a plan write still in flight, writes nothing itself; the toast says Reminders still holds
 *   today and offers the old date once, only when kan-do wrote the date and Reminders still says today.
 * - The undo window is `useUndoWindow` (the toast pauses on hover and focus, Esc closes it); an action exists only inside it.
 *   A failed restore goes through `useErrorHandler` (context `reminders_write`) and the task keeps its state.
 * - A source without a date plan (`task.reminders` absent) gets no toast.
 */
import { translate, getActiveLocale } from '~/lib/i18n'
import { useTasksStore } from '~/store/tasks'
import { useTaskSync } from '~/composables/useTaskSync'
import { useUndoWindow } from '~/composables/useUndoWindow'
import { syncToday, useToday } from '~/composables/useToday'
import { isNotPlanned } from '~/lib/taskPlanning'
import { ICONS } from '~/lib/icons'
import { wroteOf } from '~/lib/remindersSource'
import { formatDateTime } from '~/utils/localeFormat'
import { dayKey } from '~/utils/recapDay'

/** How long the toasts stay: the plan toast is an undo window like the move toast. */
export const PLAN_TOAST_MS = 6000

const TITLE_MAX_LENGTH = 40
const shortTitle = (title: string): string => (title.length > TITLE_MAX_LENGTH ? `${title.substring(0, TITLE_MAX_LENGTH)}...` : title)

/** `YYYY-MM-DD` as the user reads a date: built from its parts, never through a time zone. */
const readableDate = (key: string): string => {
  const [year, month, day] = key.split('-').map(Number)
  return formatDateTime(new Date(year!, month! - 1, day!), getActiveLocale(), 'dayMonthYear')
}

const todayKey = (): string => {
  syncToday()
  return dayKey(useToday().today.value)
}

export function usePlanToasts() {
  const tasksStore = useTasksStore()
  const { whenPlanWritten, restorePlannedDate, unplanTask } = useTaskSync()
  const planWindow = useUndoWindow('plan')
  const putBackWindow = useUndoWindow('plan-back')
  const { toast } = planWindow
  /** A restore under way: a second press (a held key, a double tap) does nothing. */
  const restoring = new Set<string>()

  async function undoPlan(id: string, toastId: string): Promise<void> {
    if (restoring.has(id)) return
    restoring.add(id)
    try {
      // The date first: when Reminders moved on the write is refused and the task stays planned, as it was
      if (await restorePlannedDate(id)) unplanTask(id)
    } finally {
      restoring.delete(id)
      planWindow.cancel(id)
      toast.remove(toastId)
    }
  }

  async function restoreOldDate(id: string, toastId: string): Promise<void> {
    if (restoring.has(id)) return
    restoring.add(id)
    try {
      await restorePlannedDate(id)
    } finally {
      restoring.delete(id)
      putBackWindow.cancel(id)
      toast.remove(toastId)
    }
  }

  /** The plan toast; resolves after the plan's write answered. Call it after `planTask` returned true. */
  async function afterPlan(id: string): Promise<void> {
    await whenPlanWritten(id)
    const task = tasksStore.task(id)
    const reminders = task?.reminders
    if (!task || !reminders || isNotPlanned(task)) return
    const today = todayKey()
    const wrote = wroteOf(task)
    const title = shortTitle(task.title)
    const toastId = `plan-${id}`

    if (wrote && wrote.to === today) {
      const noTime = reminders.due?.time == null
      const key = wrote.from === null
        ? (noTime ? 'plannedNoDateNoTime' : 'plannedNoDate')
        : (noTime ? 'plannedNoTime' : 'planned')
      toast.add({
        id: toastId,
        title: translate(`task.reminders.${key}`, { title, date: wrote.from === null ? '' : readableDate(wrote.from) }),
        icon: ICONS.dueToday,
        color: 'neutral',
        duration: PLAN_TOAST_MS,
        'onUpdate:open': (open: boolean) => { if (!open) planWindow.close(id) },
        actions: [{
          label: translate('common.undo'),
          color: 'neutral',
          variant: 'soft',
          // The action's own auto-close would report the toast as closed before Undo ran
          closeOnClick: false,
          onClick: () => { void undoPlan(id, toastId) },
        }],
      })
      planWindow.begin(id, toastId, PLAN_TOAST_MS, () => undefined)
      return
    }
    // A series is never written (it could move every occurrence): kan-do holds the plan, nothing to undo in Reminders
    if (reminders.recurrence && reminders.due?.date !== today) {
      toast.add({
        id: toastId,
        title: translate('task.reminders.plannedRecurring', { title }),
        icon: ICONS.repeats,
        color: 'neutral',
        duration: PLAN_TOAST_MS,
      })
    }
  }

  /**
   * The put-back toast; the put-back writes nothing itself. Call it after `unplanTask` returned true. It waits for the
   * plan's date write when one is still in flight (plan, then put back at once): that write cannot be stopped once the
   * bridge call started, so Reminders ends up today and the toast must say so and offer the old date.
   */
  async function afterPutBack(id: string): Promise<void> {
    await whenPlanWritten(id)
    const task = tasksStore.task(id)
    const reminders = task?.reminders
    if (!task || !reminders || !isNotPlanned(task)) return
    const today = todayKey()
    // Reminders still says another day: there is nothing to tell
    if (reminders.due?.date !== today) return
    const wrote = wroteOf(task)
    const offer = wrote !== null && wrote.from !== null && wrote.to === today ? wrote.from : null
    const toastId = `plan-back-${id}`
    toast.add({
      id: toastId,
      title: translate('task.reminders.putBack', { title: shortTitle(task.title) }),
      icon: ICONS.dueToday,
      color: 'neutral',
      duration: PLAN_TOAST_MS,
      ...(offer === null ? {} : {
        'onUpdate:open': (open: boolean) => { if (!open) putBackWindow.close(id) },
        actions: [{
          label: translate('task.reminders.restoreDate', { date: readableDate(offer) }),
          color: 'neutral',
          variant: 'soft',
          closeOnClick: false,
          onClick: () => { void restoreOldDate(id, toastId) },
        }],
      }),
    })
    if (offer !== null) putBackWindow.begin(id, toastId, PLAN_TOAST_MS, () => undefined)
  }

  return { afterPlan, afterPutBack }
}
