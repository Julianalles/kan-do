/**
 * @module integrations/sources/RemindersSource
 * @description Apple Reminders as a task source (#551, epic #481 slice 2, ADR 015 addendum "Reminders source"): an
 * adapter over `lib/reminders.ts`, the typed wrapper of the native EventKit bridge (#550, ADR 022). Desktop only: on the
 * web every call answers `unsupported`, which is `SourceNotConfiguredError` here (the source is `broken` until it is
 * reconnected on a Mac). `lib/reminders.ts` imports `@tauri-apps/api` lazily, so a board without Reminders loads nothing
 * native.
 *
 * What the adapter does: reads the open reminders (and those completed today) of every list not set to Off, and writes
 * one thing, the done tick (`reminders_set_completed`, compare-and-set on the due date it holds). It never creates,
 * deletes, moves or edits the text of a reminder (`capabilities`); `create`, `remove` and `restore` reject with
 * `RemindersReadOnlyError`, the UI never offers them. Planning by date and date writes are slice 4.
 *
 * A recurring reminder keeps one EventKit id across its occurrences, so each occurrence is its own task
 * (`reminderExternalId`, E2). Ticking one makes Reminders show the next date, so the done occurrence is no longer in the
 * fetch: the ledger (`remindersConfig.doneOccurrences`) keeps it as a Done card, built from the held task, until local
 * midnight. A held occurrence that vanishes while the same reminder shows a later date was done in Reminders and joins the
 * ledger the same way.
 */
import type { Task } from '~/types/task'
import type { IntegrationHealth } from '~/types/integration'
import { TaskStatus } from '~/types/taskStatus'
import { SOURCE_CAPABILITIES, externalIdOf } from '~/lib/taskSources'
import {
  RemindersError,
  remindersAccessStatus,
  remindersAvailable,
  remindersFetch,
  remindersLists,
  remindersSetCompleted,
  remindersSetDue,
  type ReminderDue,
  type RemindersAccessStatus,
} from '~/lib/reminders'
import {
  NOT_TODAY,
  isReadRole,
  reminderToTask,
  splitExternalId,
  startOfLocalDay,
  wroteOf,
  type DoneOccurrence,
  type ReminderListRole,
} from '~/lib/remindersSource'
import { notifyRemindersChanged } from '~/lib/remindersEvents'
import { isNotPlanned } from '~/lib/taskPlanning'
import { SourceNotConfiguredError, SourceReadOnlyError, type TaskSourceAdapter } from './types'

/** The source is read-only in kan-do: a create, delete or restore never reaches it (the UI does not offer them). */
export class RemindersReadOnlyError extends SourceReadOnlyError {
  constructor(operation: string) {
    super('reminders', operation)
    this.name = 'RemindersReadOnlyError'
  }
}

export interface RemindersSourceDeps {
  /** The role of a list; a list the user has not answered for reads as Thema. */
  roleOf: (listId: string) => ReminderListRole
  /** The tasks of this source the board holds (a ledger entry is built from one). */
  heldTasks: () => Task[]
  /** The permission as the last native call saw it; runtime only. */
  accessStatus: () => RemindersAccessStatus | null
  setAccessStatus: (status: RemindersAccessStatus) => void
  /** The ledger of recurring occurrences done today. */
  ledger: () => Record<string, DoneOccurrence>
  recordDone: (externalId: string, completedAt: number) => void
  dropDone: (externalId: string) => void
  /** Drops what was completed before local midnight. */
  pruneLedger: (now: number) => void
  health: () => IntegrationHealth
  /** Today as the local `YYYY-MM-DD` (`useToday`): a reminder's date is compared to it as the string the bridge returns. */
  today: () => string
  /** Whether today's day has begun in this window (`dayHasBegun`, `composables/useNewDay.ts`): a task dated today joins only then. */
  dayHasBegun: () => boolean
  /** The clock; tests pass their own. */
  now?: () => number
  /** A write found the stored state moved on: one quiet refetch follows. Defaults to the shared event. */
  onChanged?: () => void
}

/** Whatever the bridge rejects with, as the taxonomy of the sources: `unsupported` is "not set up". */
function fromBridge(error: unknown): unknown {
  return error instanceof RemindersError && error.kind === 'unsupported'
    ? new SourceNotConfiguredError('reminders', 'Apple Reminders is not available here (macOS desktop app only)')
    : error
}

async function viaBridge<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw fromBridge(error)
  }
}

export class RemindersSource implements TaskSourceAdapter {
  readonly id = 'reminders' as const
  readonly syncsTime = false
  /** Reminders knows open and done only: Jetzt and Wartet are kan-do's. */
  readonly holdsOnlyOpenDone = true
  /** A reminder carries neither a time box nor a priority: kan-do's own values stay over a fetch. */
  readonly keepsKanDoFields = true
  readonly capabilities = SOURCE_CAPABILITIES.reminders!
  /** The date is the plan (#553): see `TaskSourceAdapter.planningByDate`. */
  readonly planningByDate = true

  constructor(private readonly deps: RemindersSourceDeps) {}

  /** Desktop and permission `granted` as the last call saw it (`false` on the web and before the first call). */
  isConfigured(): boolean {
    return remindersAvailable() && this.deps.accessStatus() === 'granted'
  }

  async fetchActive(): Promise<Task[]> {
    const now = (this.deps.now ?? Date.now)()
    this.deps.pruneLedger(now)

    const status = await viaBridge(remindersAccessStatus)
    this.deps.setAccessStatus(status)
    // Revoked, never answered, restricted or write-only: the source needs attention ("Verbindung reparieren", #319)
    if (status !== 'granted') throw new RemindersError('access-denied')

    // A list the user switched off is never passed to the fetch; a list created in Reminders later reads as Thema
    const lists = (await viaBridge(remindersLists)).filter(list => isReadRole(this.deps.roleOf(list.id)))
    const fetched = lists.length === 0
      ? []
      : (await viaBridge(() => remindersFetch(lists.map(list => list.id), startOfLocalDay(now)))).reminders
    const titles = new Map(lists.map(list => [list.id, list] as const))
    const tasks: Task[] = []
    for (const reminder of fetched) {
      const list = titles.get(reminder.listId)
      if (list) tasks.push(this.withPlanning(reminderToTask(reminder, list, this.deps.roleOf(list.id))))
    }
    return [...tasks, ...this.doneOccurrences(tasks, now)]
  }

  /**
   * The date is the plan (#553): a reminder dated today is delivered without a planning state once the day has begun,
   * every other one (past, future, none; or today while the day has not begun) as `not-today`. The merge moves a task
   * only when that presence changes, and never takes a planned card off the board.
   */
  private withPlanning(task: Task): Task {
    const planned = task.reminders?.due?.date === this.deps.today() && this.deps.dayHasBegun()
    return planned ? task : { ...task, sourceNotPlanned: NOT_TODAY }
  }

  /** What Reminders holds the task as by its date: `not-today` unless dated today (the user's plan and put-back note it). */
  planningHeld(task: Task): string | null {
    return task.reminders?.due?.date === this.deps.today() ? null : NOT_TODAY
  }

  /** Planning needs a write when the date is not today; a recurring reminder is never written (it could move the series). */
  planWrite(task: Task): boolean {
    const reminders = task.reminders
    return reminders !== undefined && !reminders.recurrence && reminders.due?.date !== this.deps.today()
  }

  /**
   * The done occurrences of recurring reminders kept for the rest of today (E2). `fetched` is what the fetch returned:
   * an occurrence it returns itself (completed, or open again) wins and leaves the ledger.
   */
  private doneOccurrences(fetched: readonly Task[], now: number): Task[] {
    const fetchedIds = new Set(fetched.map(task => task.externalId))
    const held = this.deps.heldTasks()

    // Done in Reminders itself: a held occurrence is gone while its reminder shows a later date
    const dates = new Map<string, string[]>()
    for (const task of fetched) {
      const { id, occurrenceDate } = splitExternalId(task.externalId ?? '')
      if (occurrenceDate !== null) dates.set(id, [...(dates.get(id) ?? []), occurrenceDate])
    }
    for (const task of held) {
      const externalId = task.externalId
      if (!task.reminders?.recurrence || externalId === null || fetchedIds.has(externalId) || externalId in this.deps.ledger()) continue
      const { id, occurrenceDate } = splitExternalId(externalId)
      if (occurrenceDate !== null && (dates.get(id) ?? []).some(date => date > occurrenceDate)) {
        const completedAt = task.status === TaskStatus.Done && task.completedAt ? new Date(task.completedAt).getTime() : now
        this.deps.recordDone(externalId, completedAt)
      }
    }

    const kept: Task[] = []
    for (const [externalId, entry] of Object.entries(this.deps.ledger())) {
      const heldTask = held.find(task => task.externalId === externalId)
      if (fetchedIds.has(externalId) || !heldTask?.reminders || !isReadRole(this.deps.roleOf(heldTask.reminders.listId))) {
        this.deps.dropDone(externalId)
        continue
      }
      kept.push({ ...heldTask, status: TaskStatus.Done, completedAt: new Date(entry.completedAt) })
    }
    return kept
  }

  /**
   * Two writes, both state-based. The date (#553): a task the user planned for today whose reminder is not dated today
   * (`pendingSync.dateWrite`, set by `useTaskSync.writePlanning` and by nothing else) gets today's date, compare-and-set
   * against the date kan-do holds, and resolves to the task with what was written (`Task.reminders.wrote`). A push for any
   * other reason (a time box, a priority) never writes a date. The done tick: `set_completed` when the status changed to
   * Done or from Done, otherwise nothing is written and nothing is loaded; it always passes the due date kan-do holds as
   * `occurrenceDate`, so a retried tick of a recurring reminder can never tick its next occurrence. Resolves to `null` when
   * no date was written: the next fetch brings the state back.
   */
  async update(task: Task, change: { previousStatus?: TaskStatus } = {}): Promise<Task | null> {
    const dated = await this.writePlannedDate(task)
    // Only a change of the done state writes: a Done task pushed for another reason (a priority or time-box edit, the
    // "Gesehen" archive loop) arrives with `previousStatus` Done or none, and must not tick a reminder reopened in Reminders
    const { previousStatus } = change
    const completed = task.status === TaskStatus.Done
      ? (previousStatus !== undefined && previousStatus !== TaskStatus.Done ? true : null)
      : previousStatus === TaskStatus.Done ? false : null
    if (completed === null) return dated
    // Everything the write needs comes from `task` before the first `await`: it is the live store object
    const externalId = externalIdOf(task)
    const { id, occurrenceDate } = splitExternalId(externalId)
    const listId = task.reminders?.listId
    const recurring = !!task.reminders?.recurrence
    // A list switched off since the tick was queued passes no list: the bridge answers `not-read`
    const allowedListIds = this.allowedLists(listId)
    const occurrence = occurrenceDate ?? task.reminders?.due?.date ?? null

    try {
      await viaBridge(() => remindersSetCompleted({ id, completed, occurrenceDate: occurrence, allowedListIds }))
    } catch (error) {
      if (error instanceof RemindersError) {
        // The reminder moved on since the last fetch (the series was ticked elsewhere): nothing is written, one quiet refetch
        if (error.kind === 'changed') {
          ;(this.deps.onChanged ?? notifyRemindersChanged)()
          return dated
        }
        // Refused: the list is switched off, or the reminder is gone. The task stays as it is, the source stays healthy
        if (error.kind === 'not-read' || error.kind === 'not-found') return dated
      }
      throw error
    }
    if (recurring && completed) this.deps.recordDone(externalId, (this.deps.now ?? Date.now)())
    else if (!completed) this.deps.dropDone(externalId)
    return dated
  }

  /** The lists a write may touch: the task's own, while its role still reads it. */
  private allowedLists(listId: string | undefined): string[] {
    return listId !== undefined && isReadRole(this.deps.roleOf(listId)) ? [listId] : []
  }

  /** The date a reminder holds now (`undefined`: it is gone or its list is not read), read once after a `changed`. */
  private async readDue(id: string, listId: string): Promise<ReminderDue | null | undefined> {
    const fetched = await viaBridge(() => remindersFetch([listId], startOfLocalDay((this.deps.now ?? Date.now)())))
    const found = fetched.reminders.find(reminder => reminder.id === id)
    return found === undefined ? undefined : found.due ? { date: found.due.date, time: found.due.time } : null
  }

  /**
   * Plan for today writes today's date (#553). Everything comes from `task` before the first `await` (the live store
   * object). Never blind: `expectedDate` is the date kan-do holds; when Reminders answers `changed` the reminder is read
   * once more, no write if it says today now, else one more write against the date it holds. A reminder already dated
   * today, a recurring one, a task that is not planned any more and a refused list write nothing (a no-op success).
   */
  private async writePlannedDate(task: Task): Promise<Task | null> {
    const reminders = task.reminders
    if (task.pendingSync?.dateWrite !== true || !reminders || reminders.recurrence) return null
    if (task.status !== TaskStatus.Open || isNotPlanned(task)) return null
    const today = this.deps.today()
    if (reminders.due?.date === today) return null
    const { id } = splitExternalId(externalIdOf(task))
    const allowedListIds = this.allowedLists(reminders.listId)
    const now = this.deps.now ?? Date.now
    const written = (from: string | null, due: ReminderDue | null): Task =>
      ({ ...task, reminders: { ...reminders, due, wrote: { from, to: today, at: now() } } })

    let expectedDate = reminders.due?.date ?? null
    for (let attempt = 0; ; attempt++) {
      try {
        const due = await viaBridge(() => remindersSetDue({ id, expectedDate, date: today, allowedListIds }))
        return written(expectedDate, due)
      } catch (error) {
        if (!(error instanceof RemindersError)) throw error
        // Refused: the list is switched off, or the reminder is gone. The task stays planned here, the source stays healthy
        if (error.kind === 'not-read' || error.kind === 'not-found') return null
        if (error.kind !== 'changed') throw error
        // The date moved in Reminders after the fetch: one read decides, never a blind overwrite
        const fresh = await this.readDue(id, reminders.listId)
        if (fresh === undefined) return null
        if (fresh?.date === today) return { ...task, reminders: { ...reminders, due: fresh } }
        // A second change is not chased: the task stays pending and the next push or sync tries again
        if (attempt >= 1) throw error
        expectedDate = fresh?.date ?? null
      }
    }
  }

  /**
   * Gives back the date the user's plan overwrote (#553): compare-and-set against the date that plan wrote
   * (`wrote.to`), writing `wrote.from` (`null` clears the date, only for a reminder that had none). A task without `wrote`
   * is a no-op (an undo twice). `changed` (Reminders holds another date now) rejects: the caller reports it.
   */
  async restoreDueDate(task: Task): Promise<Task | null> {
    const wrote = wroteOf(task)
    const reminders = task.reminders
    if (!wrote || !reminders) return null
    const { id } = splitExternalId(externalIdOf(task))
    const allowedListIds = this.allowedLists(reminders.listId)
    const due = await viaBridge(() => remindersSetDue({ id, expectedDate: wrote.to, date: wrote.from, allowedListIds }))
    const { wrote: _gone, ...rest } = reminders
    return { ...task, reminders: { ...rest, due } }
  }

  create(): Promise<Task> {
    return Promise.reject(new RemindersReadOnlyError('creating a reminder'))
  }

  remove(): Promise<void> {
    return Promise.reject(new RemindersReadOnlyError('deleting a reminder'))
  }

  restore(): Promise<Task> {
    return Promise.reject(new RemindersReadOnlyError('restoring a reminder'))
  }

  archivesAsStatus(): boolean {
    return false
  }

  health(): IntegrationHealth {
    return this.deps.health()
  }
}
