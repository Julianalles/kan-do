/**
 * @module lib/remindersSource
 * @description The pure parts of the Apple Reminders task source (#551, ADR 015 addendum "Reminders source"):
 * the identity of a reminder as a task (E2), the list roles and their tolerant reader (E3), the done-occurrence
 * ledger and the mapping of a fetched reminder to a `Task`. No store, no native call: `RemindersSource` and
 * `store/remindersConfig.ts` build on it.
 */
import type { Reminder, ReminderList } from '~/lib/reminders'
import type { Task, TaskReminders } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { DEFAULT_PRIORITY } from '~/lib/priority'

/** What a list of Reminders is on the board: a Thema, an Aktivität, or not read at all (`off`). */
export type ReminderListRole = 'topic' | 'activity' | 'off'

export const REMINDER_LIST_ROLES: readonly ReminderListRole[] = ['topic', 'activity', 'off']

/** The role a list reads as until the user answered (a list created in Reminders later, a malformed stored role). */
export const DEFAULT_LIST_ROLE: ReminderListRole = 'topic'

export interface ReminderListConfig {
  role: ReminderListRole
  /** The list's title as the user last saw it (settings, slice 3); the board reads the live title of a fetch. */
  title: string
}

/** A recurring occurrence the user completed today: kept as a Done card until local midnight (E2). */
export interface DoneOccurrence {
  /** Epoch ms */
  completedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const isListRole = (value: unknown): value is ReminderListRole =>
  (REMINDER_LIST_ROLES as readonly unknown[]).includes(value)

/** A stored `lists` value made usable: a malformed role reads as `topic`, a malformed entry is dropped. Pure, never writes. */
export function readLists(raw: unknown): Record<string, ReminderListConfig> {
  if (!isRecord(raw)) return {}
  const lists: Record<string, ReminderListConfig> = {}
  for (const [id, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue
    lists[id] = { role: isListRole(entry.role) ? entry.role : DEFAULT_LIST_ROLE, title: typeof entry.title === 'string' ? entry.title : '' }
  }
  return lists
}

/** A stored ledger made usable: entries without a finite `completedAt` are dropped. */
export function readLedger(raw: unknown): Record<string, DoneOccurrence> {
  if (!isRecord(raw)) return {}
  const ledger: Record<string, DoneOccurrence> = {}
  for (const [externalId, entry] of Object.entries(raw)) {
    if (isRecord(entry) && typeof entry.completedAt === 'number' && Number.isFinite(entry.completedAt)) {
      ledger[externalId] = { completedAt: entry.completedAt }
    }
  }
  return ledger
}

const OCCURRENCE_SUFFIX = /^(.+)@(\d{4}-\d{2}-\d{2})$/

/**
 * The `externalId` of a fetched reminder (E2): the `calendarItemIdentifier` for a one-off reminder; a recurring one
 * keeps one EventKit id across its occurrences, so each occurrence is its own task, `<id>@<YYYY-MM-DD>` of its due date.
 */
export function reminderExternalId(reminder: Pick<Reminder, 'id' | 'due' | 'recurrence'>): string {
  return reminder.recurrence && reminder.due ? `${reminder.id}@${reminder.due.date}` : reminder.id
}

/** An `externalId` taken apart: the id EventKit knows and the occurrence date the suffix names (`null`: a one-off reminder). */
export function splitExternalId(externalId: string): { id: string; occurrenceDate: string | null } {
  const match = OCCURRENCE_SUFFIX.exec(externalId)
  return match ? { id: match[1]!, occurrenceDate: match[2]! } : { id: externalId, occurrenceDate: null }
}

/** Start of the local day of `now`, epoch ms: what `reminders_fetch` takes as `completedSince` and when the ledger is pruned. */
export function startOfLocalDay(now: number): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** Whether a role means the list is read (`reminders_fetch`, writes). */
export const isReadRole = (role: ReminderListRole): boolean => role !== 'off'

/**
 * A fetched reminder as a task. `topic` is the list title for a list with the role Thema, `activity` for the role
 * Aktivität, the other stays null. Priority and time box are kan-do's own (a reminder carries neither), so a new card
 * starts with the defaults and `mergeTasks` keeps what kan-do holds for a known one (`keepsKanDoFields`). A task is
 * delivered without a planning state: it starts Offen (slice 4 adds the date rules).
 */
export function reminderToTask(reminder: Reminder, list: Pick<ReminderList, 'title'>, role: ReminderListRole): Task {
  const externalId = reminderExternalId(reminder)
  return {
    id: externalId,
    externalId,
    source: 'reminders',
    title: reminder.title || '',
    notes: reminder.notes || null,
    status: reminder.completed ? TaskStatus.Done : TaskStatus.Open,
    priority: DEFAULT_PRIORITY,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    topic: role === 'topic' ? list.title : null,
    topicColorCode: null,
    activity: role === 'activity' ? list.title : null,
    timerId: null,
    isUnplanned: false,
    ...(reminder.completed && reminder.completedAt !== null ? { completedAt: new Date(reminder.completedAt) } : {}),
    reminders: {
      due: reminder.due ? { date: reminder.due.date, time: reminder.due.time } : null,
      recurrence: reminder.recurrence?.rule ?? null,
      listId: reminder.listId,
    },
  }
}

/** `Task.reminders.wrote` made usable: anything but `{ from: string | null, to: string, at: finite number }` reads as none. */
export function wroteOf(task: Pick<Task, 'reminders'>): NonNullable<TaskReminders['wrote']> | null {
  const wrote: unknown = task.reminders?.wrote
  if (!isRecord(wrote)) return null
  const { from, to, at } = wrote
  if (typeof to !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null
  if (from !== null && typeof from !== 'string') return null
  return { from, to, at }
}

/** The planning state a source that plans by date delivers (`Task.sourceNotPlanned`): a date that is not today, or today before the day has begun. */
export const NOT_TODAY = 'not-today'
