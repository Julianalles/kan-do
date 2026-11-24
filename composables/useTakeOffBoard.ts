/**
 * @composable useTakeOffBoard
 * @description The one way the app takes the unfinished tasks off today's board (#387, #480): the fresh start of a new
 * morning (`useNewDay().freshStart`) and the day close of the evening (`useDayCloseAction().finishDay`) both call it, so
 * what "not planned" means for a task (its timer, its column, its connection) is decided once.
 * @responsibility
 * - Jetzt tasks stop their timer and go to Offen through the shared move path (the stop writes the collected seconds
 *   first); a refused move leaves the task in Jetzt and its timer running again. Wartet tasks keep their status
 *   (#794: the marker is a thing of its own, #793). Then every Offen and Wartet task is taken off the board in one
 *   store action through `useTaskSync.unplanTasks`, which writes the "not planned" status of an Offen task to a source
 *   that stores planning (Notion with such a status mapped, #357); a Wartet task, and Local, Todoist and Reminders,
 *   get no planning write. Demo tasks stay.
 * - Synchronous: every local change has happened when it returns; only the writes to the tasks' connections run on.
 * - Moves nothing else and decides nothing about days: the caller writes its own marker (`markNewDay`,
 *   `markDayClosed`) and the carry-over bookkeeping; it must be called with writes allowed and the day close closed
 *   (the callers check). Resolve it in a component's setup: it holds the Nuxt-bound move path.
 */
import { useTasksStore } from '~/store/tasks'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskSync } from '~/composables/useTaskSync'
import { resumeTaskTimer, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { isDemoTaskId } from '~/lib/demoIds'
import { TaskStatus } from '~/types/taskStatus'

export interface TakenOffBoard {
  /** The Jetzt and Offen tasks taken off, Jetzt first, in board order: the first half of the panel "Zuletzt geplant und nicht erledigt". */
  group: string[]
  /** Every task taken off the board, the Wartet ones included (they are not in `group`). */
  sent: string[]
  /** The Wartet tasks taken off (they stay Wartet): kept in the panel after the group until each is planned again. */
  fromWaiting: string[]
}

export function useTakeOffBoard() {
  const tasksStore = useTasksStore()
  const { moveTaskToStatus } = useTaskOperations()
  const { unplanTasks } = useTaskSync()

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
    // Wartet keeps its status (#794, epic #374): the marker alone takes a waiting task off today, and `unplanTasks`
    // writes nothing to any connection for it (#793)
    const waiting = tasksStore.tasksWaiting.filter(task => !isDemoTaskId(task.id)).map(task => task.id)

    // The user's own move: a source that stores planning gets its "not planned" status written for an Offen task (#357)
    const sent = unplanTasks([...group, ...waiting])
    const fromWaiting = waiting.filter(id => sent.includes(id))
    return { group: group.filter(id => sent.includes(id)), sent, fromWaiting }
  }

  return { takeOffBoard, unfinished }
}
