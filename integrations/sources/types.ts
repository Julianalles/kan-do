/**
 * @module integrations/sources/types
 * @description The task source adapter: one interface for Local, Notion and Todoist (#318, epic #264 D3).
 *
 * `useTaskSync` routes a task's operation to the adapter of `task.source`, and the integration manager
 * fetches every connected source through its adapter. Adapters are thin wrappers: the integration classes
 * keep their behaviour. Adapters receive tasks, never ids: an integration is addressed by `externalIdOf(task)`.
 */
import type { Task } from '~/types/task'
import type { TaskStatus } from '~/types/taskStatus'
import type { IntegrationHealth } from '~/types/integration'
import type { SourceId } from '~/types/taskSource'

/** The source cannot be called: its credentials or configuration are missing. */
export class SourceNotConfiguredError extends Error {
  readonly source: SourceId

  constructor(source: SourceId, message: string) {
    super(message)
    this.name = 'SourceNotConfiguredError'
    this.source = source
  }
}

/** A source's active tasks together with what the list leaves out (`TaskSourceAdapter.fetchActiveList`). */
export interface FetchedTasks {
  tasks: Task[]
  /**
   * The values of `Task.sourceNotPlanned` for which `tasks` is only a part of what the source holds (#357: Notion
   * loads the most recently edited pages of its "not planned" statuses up to a limit). Empty: the list is
   * complete. `mergeTasks` keeps a held task with one of these values that the list lacks; every other task the
   * list lacks is gone at the source, as with a complete list.
   */
  partialNotPlanned: readonly string[]
}

export interface TaskSourceAdapter {
  readonly id: SourceId
  /** Whether time spent is written upstream (Notion). Todoist has no such field, Local has no upstream. */
  readonly syncsTime: boolean

  /** Whether the source can be called (credentials and configuration present). Local always can. */
  isConfigured(): boolean

  /**
   * The source's active tasks. Rejects on any failure (`SourceNotConfiguredError` when it is not set up),
   * so a caller can tell a failed fetch from an empty one. Local returns the Local tasks of the board.
   */
  fetchActive(): Promise<Task[]>

  /**
   * `fetchActive` for a source whose list can be a part of what it holds (Notion's capped "not planned" pages,
   * #357): the same tasks, plus what the list leaves out. The integration manager fetches through it when it
   * exists, so the answer belongs to exactly that fetch. Absent: `fetchActive` is always complete.
   */
  fetchActiveList?(): Promise<FetchedTasks>

  /**
   * For a source that holds time rounded to a unit (Notion minutes/hours): maps a local total to the total the
   * source reads back for it. `mergeTasks` treats a fetched value equal to that as the local total itself, so the
   * rounding neither queues a push nor changes the local seconds (#323). Absent: values are compared as they are.
   */
  timeHolding?(): (seconds: number) => number

  /**
   * Whether a push can write the task's time at all. A source whose time property takes no number (a Notion
   * `select`, #331) says `false`: `mergeTasks` then queues no time push for it, as the write would be skipped and
   * the next fetch would queue it again. Absent: `true`. Never rejects (an unknown answer is `true`).
   */
  timeWritable?(): Promise<boolean>

  /**
   * What the source holds a task as that the user puts back to "Meine Aufgaben" (#357): the Notion status a
   * put-back is written as (the first mapped "not planned" status). `null` or absent: the source stores no
   * planning, so plan and put-back stay in kan-do (Local, Todoist, Notion without such a status). `useTaskSync`
   * writes a plan or a put-back upstream only when this answers a value.
   */
  notPlannedHold?(): string | null

  /**
   * `true` for a source that only knows open and completed (Todoist): a task it reports as open keeps the board
   * column kan-do holds it in (Jetzt, Wartet), instead of going back to Offen with every fetch (#357).
   */
  readonly holdsOnlyOpenDone?: boolean

  /**
   * `true` for a source without a planning state of its own whose tasks start not planned (#357, the user's
   * decision of 2026-11-16: Todoist, whatever the due date): an Open task kan-do sees for the first time starts
   * under "Meine Aufgaben". A task kan-do already holds is never moved by a fetch (#387: the app moves no card by
   * itself), so the cards an existing board had before the rule stay where they are.
   */
  readonly startsNotPlanned?: boolean

  /** Creates a task upstream and resolves to it, source and externalId stamped. */
  create(draft: Partial<Task>): Promise<Task>

  /**
   * Writes the task's current state upstream. `change.previousStatus` is the status the source held before
   * (Todoist completes, or reopens when it was `Done`; `useTaskSync` takes it from the task's `pendingSync.upstreamDone`
   * when there is one, so a replay after a restart reopens too, #344). Resolves to the task as the source now holds it (Notion), or
   * `null` when the source returns nothing to merge back (Todoist, Local). `change.timeEdited`: the user set the
   * task's total time spent (kd#4), so a source that stores time writes it even at 0 (Notion clears the property).
   */
  update(task: Task, change?: { previousStatus?: TaskStatus; timeEdited?: boolean }): Promise<Task | null>

  /** Removes the task upstream: Notion archives the page, Todoist deletes the task, Local has nothing upstream. */
  remove(task: Task): Promise<void>

  /**
   * Brings a trashed task (#422) back to the source and resolves to it as the source now holds it, `id` kept
   * (the app-level identity never changes), `externalId` as the source knows it now. The caller passes the
   * snapshot with the status it is restored with. Local: nothing upstream. Notion: un-archives the same page
   * and writes the snapshot, creating a new page when the old one is gone. Todoist: creates a new task
   * (a new `externalId`; comments and other data kan-do never stored are not restored). Rejects on failure.
   */
  restore(task: Task): Promise<Task>

  /**
   * Whether archiving a task is a status write on the source's side (Notion with an archive status mapped, or
   * not configured: the write then fails as not configured and is reported once).
   */
  archivesAsStatus(): boolean

  /** Current health of the source (Local is always healthy). */
  health(): IntegrationHealth
}
