/**
 * @module lib/taskPlanning
 * @description Whether a task is planned for today, i.e. on the board (#353, epic #334).
 *
 * A task is planned unless it carries `notPlanned: true` and its status is Open. The marker is kan-do's own
 * state and additive: data stored before #353 has no marker, so every older task reads as planned. A connection
 * that has a planning state of its own (#357: Notion with "not planned" statuses mapped) is followed only when
 * that state changes there (`Task.sourceNotPlanned`, the rule is in `tasksStore.mergeTasks`).
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
 * The one rule for a marker across a status write (#353): it survives only on a task that was Open and stays Open.
 * Every writer of a status (`updateTask`, the batch move, `mergeTasks`, `inStatus`) asks here.
 */
export function markerSurvives(before: TaskStatus, after: TaskStatus): boolean {
  return before === TaskStatus.Open && after === TaskStatus.Open
}

/**
 * A copy of `task` in `status` (a restore or an undo that puts a Jetzt task back into Offen). The marker stays
 * only on a task that was Open and stays Open: a snapshot from another column may carry a stale one (an older
 * app version moved the task on), and in Offen that marker would hide the task (#354).
 */
export function inStatus<T extends Pick<Task, 'notPlanned' | 'status'>>(task: T, status: TaskStatus): T {
  const { notPlanned, ...rest } = task
  const keeps = notPlanned === true && markerSurvives(task.status, status)
  return { ...rest, status, ...(keeps ? { notPlanned: true as const } : {}) } as T
}

/** The tasks that are on today's board: what every "board" reader works on. */
export function plannedTasks<T extends Pick<Task, 'notPlanned' | 'status'>>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => !isNotPlanned(task))
}
