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
  type RemindersAccessStatus,
} from '~/lib/reminders'
import {
  isReadRole,
  reminderToTask,
  splitExternalId,
  startOfLocalDay,
  type DoneOccurrence,
  type ReminderListRole,
} from '~/lib/remindersSource'
import { notifyRemindersChanged } from '~/lib/remindersEvents'
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
      if (list) tasks.push(reminderToTask(reminder, list, this.deps.roleOf(list.id)))
    }
    return [...tasks, ...this.doneOccurrences(tasks, now)]
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
   * The done tick, both ways: `set_completed` when the status changed to Done or from Done, otherwise nothing is
   * written and nothing is loaded. Always passes the due date kan-do holds as `occurrenceDate`, so a retried tick of a
   * recurring reminder can never tick its next occurrence. Resolves to `null`: the next fetch brings the state back.
   */
  async update(task: Task, change: { previousStatus?: TaskStatus } = {}): Promise<Task | null> {
    const completed = task.status === TaskStatus.Done ? true : change.previousStatus === TaskStatus.Done ? false : null
    if (completed === null) return null
    // Everything the write needs comes from `task` before the first `await`: it is the live store object
    const externalId = externalIdOf(task)
    const { id, occurrenceDate } = splitExternalId(externalId)
    const listId = task.reminders?.listId
    const recurring = !!task.reminders?.recurrence
    // A list switched off since the tick was queued passes no list: the bridge answers `not-read`
    const allowedListIds = listId !== undefined && isReadRole(this.deps.roleOf(listId)) ? [listId] : []
    const occurrence = occurrenceDate ?? task.reminders?.due?.date ?? null

    try {
      await viaBridge(() => remindersSetCompleted({ id, completed, occurrenceDate: occurrence, allowedListIds }))
    } catch (error) {
      if (error instanceof RemindersError) {
        // The reminder moved on since the last fetch (the series was ticked elsewhere): nothing is written, one quiet refetch
        if (error.kind === 'changed') {
          ;(this.deps.onChanged ?? notifyRemindersChanged)()
          return null
        }
        // Refused: the list is switched off, or the reminder is gone. The task stays as it is, the source stays healthy
        if (error.kind === 'not-read' || error.kind === 'not-found') return null
      }
      throw error
    }
    if (recurring && completed) this.deps.recordDone(externalId, (this.deps.now ?? Date.now)())
    else if (!completed) this.deps.dropDone(externalId)
    return null
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
