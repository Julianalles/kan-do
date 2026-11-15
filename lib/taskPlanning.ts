/**
 * @module lib/taskPlanning
 * @description Whether a task is planned for today, i.e. on the board (#353, epic #334).
 *
 * A task is planned unless it carries `notPlanned: true` and its status is Open. The marker lives in kan-do
 * only (nothing is written to a connection for it) and is additive: data stored before #353 has no marker,
 * so every older task reads as planned.
 */
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

/**
 * The single reader of `Task.notPlanned`. Strict on purpose: any other stored value (`false`, `null`, a
 * string from a damaged file) reads as planned, and so does a marker left on a task that is no longer Open
 * (an older app version moved it), so a task can never be hidden by a stale marker.
 */
export function isNotPlanned(task: Pick<Task, 'notPlanned' | 'status'>): boolean {
  return task.notPlanned === true && task.status === TaskStatus.Open
}

/** The tasks that are on today's board: what every "board" reader works on. */
export function plannedTasks<T extends Pick<Task, 'notPlanned' | 'status'>>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => !isNotPlanned(task))
}
