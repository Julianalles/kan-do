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

/**
 * A copy of `task` in `status` (a restore or an undo that puts a Jetzt task back into Offen). The marker stays
 * only on a task that was Open and stays Open: a snapshot from another column may carry a stale one (an older
 * app version moved the task on), and in Offen that marker would hide the task (#354).
 */
export function inStatus<T extends Pick<Task, 'notPlanned' | 'status'>>(task: T, status: TaskStatus): T {
  const { notPlanned, ...rest } = task
  const keeps = notPlanned === true && task.status === TaskStatus.Open && status === TaskStatus.Open
  return { ...rest, status, ...(keeps ? { notPlanned: true as const } : {}) } as T
}

/** The tasks that are on today's board: what every "board" reader works on. */
export function plannedTasks<T extends Pick<Task, 'notPlanned' | 'status'>>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => !isNotPlanned(task))
}
