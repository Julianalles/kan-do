/**
 * @module lib/taskPlanning
 * @description Whether a task is planned for today, i.e. on the board (#353, epic #334).
 *
 * A task is planned unless it carries `notPlanned: true` and its status is Open. The marker is kan-do's own
 * state and additive: data stored before #353 has no marker, so every older task reads as planned. A connection
 * that has a planning state of its own (#357: Notion with "not planned" statuses mapped, Todoist, where every
 * task starts not planned) is followed only when that state changes there (`sourceMarker`).
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

/**
 * The marker a merged task carries (#357). `held` is what the source held the task as before this fetch
 * (`Task.sourceNotPlanned` of the stored task, `undefined` for a task seen for the first time: its marker is the
 * source's), `fetched` what it holds now. Only a change at the source moves the task: the same answer as last time
 * leaves `local` (the stored marker) alone, so a task kan-do planned or put back by itself stays where it is.
 * @returns whether the merged task is not planned, before the status rule (`markerSurvives`) is applied
 */
export function sourceMarker(local: boolean, held: string | undefined, fetched: string | undefined, firstSeen = false): boolean {
  if (firstSeen) return fetched !== undefined
  // Which "not planned" status it is does not matter here: Backlog to Someday is no move
  if ((held !== undefined) === (fetched !== undefined)) return local
  return fetched !== undefined
}
