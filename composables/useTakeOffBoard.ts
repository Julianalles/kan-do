/**
 * @composable useTakeOffBoard
 * @description The one way the app takes the unfinished tasks off today's board (#387, #480): the fresh start of a new
 * morning (`useNewDay().freshStart`) and the day close of the evening (`useDayCloseAction().finishDay`) both call it, so
 * what "not planned" means for a task (its timer, its column, its connection) is decided once.
 * @responsibility
 * - Jetzt tasks stop their timer and go to Offen through the shared move path (the stop writes the collected seconds
 *   first); a refused move leaves the task in Jetzt and its timer running again. Wartet tasks go to Offen through the
 *   batch status path (their writes run one after another). Then every task that is Offen is taken off the board in one
 *   store action through `useTaskSync.unplanTasks`, which writes the "not planned" status to a source that stores
 *   planning (Notion with such a status mapped, #357); Local and Todoist get no planning write. Demo tasks stay.
 * - Synchronous: every local change has happened when it returns; only the writes to the tasks' connections run on.
 * - Moves nothing else and decides nothing about days: the caller writes its own marker (`markNewDay`,
 *   `markDayClosed`) and the carry-over bookkeeping; it must be called with writes allowed and the day close closed
 *   (the callers check). Resolve it in a component's setup: it holds the Nuxt-bound move path.
 */
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskSync } from '~/composables/useTaskSync'
import { resumeTaskTimer, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { isDemoTaskId } from '~/lib/demoIds'
import { TaskStatus } from '~/types/taskStatus'

export interface TakenOffBoard {
  /** The Jetzt and Offen tasks taken off, Jetzt first, in board order: the first half of the panel "Gestern auf dem Board". */
  group: string[]
  /** Every task taken off the board, the Wartet ones included (they are not in `group`). */
  sent: string[]
  /** The tasks taken off from Wartet: kept in the panel after them until each is planned again. */
  fromWaiting: string[]
}

export function useTakeOffBoard() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const { moveTaskToStatus } = useTaskOperations()
  const { unplanTasks, updateTaskStatuses } = useTaskSync()

  /** What taking off would move: Jetzt, Offen and Wartet without the demo tasks, in that order. */
  function unfinished() {
    return [...tasksStore.tasksProgress, ...tasksStore.tasksOpen, ...tasksStore.tasksWaiting].filter(task => !isDemoTaskId(task.id))
  }

  function takeOffBoard(): TakenOffBoard {
    const group: string[] = []
    for (const task of tasksStore.tasksProgress.filter(task => !isDemoTaskId(task.id))) {
      const { id } = task
      // The stop writes the collected seconds first, so the store holds everything the timer counted
      stopTaskTimer(id)
      // Local change at once (status, board order); the write to the task's connection follows on its own
      void moveTaskToStatus(id, TaskStatus.Open).catch(() => {})
      if (tasksStore.task(id)?.status === TaskStatus.Open) group.push(id)
      // A refused move leaves the task in Jetzt: it keeps counting, as after any refused move
      else resumeTaskTimer(id)
    }
    for (const task of tasksStore.tasksOpen) {
      if (!isDemoTaskId(task.id) && !group.includes(task.id)) group.push(task.id)
    }
    // Wartet is reset too (#387): Offen locally at once, the writes to a connection one after another
    const waiting = tasksStore.tasksWaiting.filter(task => !isDemoTaskId(task.id)).map(task => task.id)
    if (waiting.length > 0) void updateTaskStatuses(waiting, TaskStatus.Open).catch(() => {})

    // The user's own move: a source that stores planning gets its "not planned" status written (#357)
    const sent = unplanTasks([...group, ...waiting])
    const fromWaiting = waiting.filter(id => sent.includes(id))
    boardStore.noteFromWaiting(fromWaiting)
    return { group: group.filter(id => sent.includes(id)), sent, fromWaiting }
  }

  return { takeOffBoard, unfinished }
}
