/**
 * @module reminders
 * @description Typed wrapper over the Rust `reminders_*` commands (`src-tauri/src/reminders.rs`, #550, ADR 022):
 * the native Apple Reminders bridge of the macOS desktop app. Desktop only: on the web (no Tauri) every call
 * answers `unsupported` without touching `@tauri-apps/api`, which is imported lazily so the web build never loads it.
 *
 * Rules the contract carries (slices 2 to 4 of epic #481 rely on them):
 * - `remindersAccessStatus` never prompts; `remindersRequestAccess` is the only call that can show the macOS prompt.
 * - Dates are components, never instants: `ReminderDue.date` is `YYYY-MM-DD` and `time` `HH:mm` or `null`, exactly as
 *   Reminders holds them; nothing here converts them through a time zone.
 * - The two writes are compare-and-set (`changed` when the stored state moved) and answer with the state re-read after
 *   the save. `allowedListIds` is the set of lists kan-do reads; a reminder elsewhere answers `not-read`.
 * - v1 never creates, deletes, moves or edits the text of a reminder: this module has no function that does.
 *
 * Errors are one typed union shared with the adapter of slice 2 ({@link RemindersErrorName}); no platform text.
 */
import { isTauri } from '~/utils/isTauri'

/** The error names Rust's `RemindersError` serializes to. */
export const REMINDERS_ERROR_NAMES = [
  'unsupported',
  'access-denied',
  'not-read',
  'not-found',
  'changed',
  'invalid-request',
  'save-failed',
  'failed',
] as const
export type RemindersErrorName = (typeof REMINDERS_ERROR_NAMES)[number]

export class RemindersError extends Error {
  readonly kind: RemindersErrorName

  constructor(kind: RemindersErrorName) {
    super(`reminders: ${kind}`)
    this.name = 'RemindersError'
    this.kind = kind
  }
}

/** Maps whatever `invoke` rejected with (Rust sends the bare kebab string) to a `RemindersError`. */
export function toRemindersError(error: unknown): RemindersError {
  if (error instanceof RemindersError) return error
  const name = typeof error === 'string' ? error : (error as { kind?: unknown } | null)?.kind
  return new RemindersError(REMINDERS_ERROR_NAMES.find(known => known === name) ?? 'failed')
}

export type RemindersAccessStatus = 'notDetermined' | 'granted' | 'denied' | 'restricted' | 'writeOnly'

export interface ReminderList {
  /** `EKCalendar.calendarIdentifier` */
  id: string
  title: string
  /** `#rrggbb` */
  color: string | null
  /** Incomplete reminders. */
  openCount: number
  allowsWrites: boolean
}

export interface ReminderDue {
  /** `YYYY-MM-DD` */
  date: string
  /** `HH:mm`, or `null` for a date-only reminder. */
  time: string | null
}

export interface Reminder {
  /** `calendarItemIdentifier` */
  id: string
  listId: string
  title: string
  notes: string
  completed: boolean
  /** Epoch ms. */
  completedAt: number | null
  due: ReminderDue | null
  /** `FREQ=WEEKLY;INTERVAL=2`: informational. */
  recurrence: { rule: string } | null
}

export interface RemindersFetchResult {
  reminders: Reminder[]
  /** Requested lists that do not exist (any more): skipped, not an error. */
  missingListIds: string[]
}

export interface RemindersCompletion {
  completed: boolean
  /** For a recurring reminder: the date that follows (or `null` when the series ended). */
  due: ReminderDue | null
}

export interface SetDueArgs {
  id: string
  /** The due date kan-do holds (`null` = none): the write happens only while the stored one still equals it. */
  expectedDate: string | null
  /** `null` clears the date; used only to restore a reminder that had none. */
  date: string | null
  allowedListIds: string[]
}

export interface SetCompletedArgs {
  id: string
  completed: boolean
  /** The due date kan-do holds (`null` = none), always passed: a recurring reminder whose stored date differs answers `changed`, so a retried tick never ticks the next occurrence. */
  occurrenceDate: string | null
  allowedListIds: string[]
}

/** True where the bridge can exist at all (the desktop shell); the OS check is Rust's (`unsupported`). */
export const remindersAvailable = (): boolean => isTauri()

let supportedProbe: Promise<boolean> | null = null

/**
 * Whether Reminders can be set up here: the desktop shell, and the bridge does not answer `unsupported` (a Mac with a
 * macOS that has no Reminders access API). Asks `reminders_access_status`, which never prompts; the answer is cached
 * for the session. The checkbox of the welcome flow and the row of the sources tab are enabled only on `true` (#552).
 */
export function remindersSupported(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false)
  supportedProbe ??= remindersAccessStatus().then(() => true, (error) => toRemindersError(error).kind !== 'unsupported')
  return supportedProbe
}

/** Forgets the cached probe (tests). */
export function resetRemindersSupportedProbe(): void {
  supportedProbe = null
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new RemindersError('unsupported')
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw toRemindersError(error)
  }
}

/** The permission. Never prompts and never reads a reminder. */
export const remindersAccessStatus = (): Promise<RemindersAccessStatus> => call('reminders_access_status')

/** Shows the macOS prompt when the user has not answered yet; answers the status afterwards. Call it from a user action only. */
export const remindersRequestAccess = (): Promise<RemindersAccessStatus> => call('reminders_request_access')

/** Needs `granted`, else `access-denied`. */
export const remindersLists = (): Promise<ReminderList[]> => call('reminders_lists')

/** The incomplete reminders of `listIds` plus those completed since `completedSince` (epoch ms, start of the local day). Reads no other list. */
export const remindersFetch = (listIds: string[], completedSince: number): Promise<RemindersFetchResult> =>
  call('reminders_fetch', { listIds, completedSince })

/** Compare-and-set of the due date (year, month and day only); answers the stored due date after the save. */
export const remindersSetDue = (args: SetDueArgs): Promise<ReminderDue | null> =>
  call('reminders_set_due', { ...args })

/** Ticks or unticks one reminder; answers the state re-read after the save. */
export const remindersSetCompleted = (args: SetCompletedArgs): Promise<RemindersCompletion> =>
  call('reminders_set_completed', { ...args })

/** Opens System Settings at Privacy & Security > Reminders. */
export const remindersOpenSettings = (): Promise<void> => call('reminders_open_settings')
