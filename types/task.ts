import { TaskStatus } from "~/types/taskStatus";
import { DEFAULT_PRIORITY } from "~/lib/priority";
import type { CustomPropertyType } from "~/types/notion";
import type { SourceId } from "~/types/taskSource";

export type TaskCustomValue =
  | { type: 'text'; value: string | null }
  | { type: 'number'; value: number | null }
  | { type: 'select'; value: { name: string; color?: string } | null }
  | { type: 'multi_select'; value: Array<{ name: string; color?: string }> }
  | { type: 'date'; value: { start: string; end?: string } | null }
  | { type: 'checkbox'; value: boolean }
  | { type: 'url'; value: string | null }
  | { type: 'email'; value: string | null }
  | { type: 'phone_number'; value: string | null };

export interface TaskCustomEntry {
  /** Stable key (slug) for this custom property */
  key: string;
  /** Original Notion property name (for display) */
  name: string;
  /** Normalized type */
  propType: CustomPropertyType;
  /** Typed value */
  value: TaskCustomValue;
  /** Whether this property is configured but missing from the task */
  isMissing?: boolean;
}

/** `Task.reminders`: the Reminders side of a task the date logic needs (#551). */
export interface TaskReminders {
  due: { date: string; time: string | null } | null;
  recurrence: string | null;
  listId: string;
  /**
   * The date kan-do wrote when the user planned the task for today (#553): `from` is the date Reminders held (`null`: none),
   * `to` the date written (today then), `at` when (epoch ms). It makes the plan's "Rückgängig" and the put-back's "Altes Datum
   * zurück" possible and is dropped once the date is restored or Reminders holds another date than `to`. Additive and
   * tolerant: older data has none, a malformed value reads as none (`wroteOf`, `lib/remindersSource.ts`).
   */
  wrote?: { from: string | null; to: string; at: number };
}

/**
 * Marks a task whose local state the source does not hold yet (#319). State-based: the adapter pushes the
 * task as it is now, so one marker covers any number of changes. Set before the write, cleared when it
 * succeeds, persisted with the task so it survives a restart. Pending time updates are one reason for it.
 */
export interface PendingSync {
  /** When the first unpushed change was made (epoch ms) */
  since: number;
  /** Failed pushes since then */
  attempts: number;
  /** Message of the last failed push; null while none has failed yet */
  lastError: string | null;
  /**
   * Whether the source holds the task as completed (Todoist: a reopen is only sent for a task it holds as
   * completed, #344). Set with the marker from the status the task had before its first unpushed change, so a
   * replay after a restart needs no in-memory state. Absent on a marker written before #344.
   */
  upstreamDone?: boolean;
  /**
   * A create of this never-created task ended with an unknown outcome (a timeout, a network error, a 5xx: the page may
   * exist, #528). `since` is the epoch ms of the first such attempt, `at` the last, `title` the title the last one sent (the title can
   * be edited while the task waits). While it is set the next create looks the page up first and adopts it instead of
   * making a second one. Absent: no create is in doubt.
   */
  createUncertain?: CreateUncertain;
  /**
   * The push has to write today's date to the reminder (#553): set when the user plans a task of a source that plans by
   * date and its date is not today. State-based pushes of other changes (a time box, a priority) never write a date;
   * only this flag does, and a put-back before the write clears it. Gone with the marker once the push succeeded. The value
   * is the local day (`YYYY-MM-DD`) the plan was made for: a write that failed and is retried on a later day writes
   * nothing (the plan was that day's, the user never planned this one). Any other value, an older `true` included, never writes.
   */
  dateWrite?: string;
}

export interface CreateUncertain {
  /** Epoch ms of the first doubtful attempt. */
  since: number;
  /** Epoch ms of the last one: the page may still land until a while after it (`createMayLandUntil`). Absent on a marker without it: `since` stands in. */
  at?: number;
  title: string;
}

/**
 * A move to another source that did not finish (#322 consumes it): the task already carries the new
 * source, this names where it came from so the old copy can still be removed.
 */
export interface PendingMove {
  fromSource: SourceId;
  fromExternalId: string | null;
  toSource: SourceId;
  /** `Task.sourceNotPlanned` as the origin held it (#357), put back when the move is undone or reverted. */
  fromSourceNotPlanned?: string;
  /**
   * The task's create in the origin ended with an unknown outcome and had no `externalId` when it moved (#538): the
   * origin page may exist. Present only while `fromExternalId` is null; the origin removal looks the page up and
   * archives it (or a fetch hands it over and it becomes `fromExternalId`), and an undo puts it back on the marker.
   */
  fromCreateUncertain?: CreateUncertain;
}

interface Task {
  /**
   * Stable app-level identity. It never changes, not even when the task moves to another source, so
   * statistics, column order, carry-over, archive, timers and routes (all keyed by `id`) need no re-keying.
   * Equals the page id for Notion-born tasks and is generated for Local-born ones. Integrations never
   * receive it: they get `externalId`.
   */
  id: string;
  /** Where the task lives. Changes only together with `externalId`, in one store mutation. */
  source: SourceId;
  /** The id the task's integration knows it by (the Notion page id); `null` for a Local task. */
  externalId: string | null;
  status: TaskStatus;
  title: string;
  activity: string | null;
  topic: string | null;
  topicColorCode: string | null;
  priority: number;
  notes: string | null;
  timeBoxSeconds: number | null;
  timeSpentSeconds: number | 0;
  timerId: number | null;
  /** Additional imported properties from Notion (keyed by stable slug) */
  custom?: Record<string, TaskCustomEntry>;
  /** When task was marked as done */
  completedAt?: Date | null;
  /**
   * The user set `completedAt` by hand (the done day of a task marked done late, kd#131). While the task stays
   * done, a fetch or a write echo of its source does not replace the time (`mergeTasks`, `applySyncedTask`).
   * Cleared by any other write of `completedAt` (reopening, completing again). Absent on older stored tasks.
   */
  completedAtCorrected?: boolean;
  /** When task was created */
  createdAt?: Date | null;
  /** When task was last updated */
  updatedAt?: Date | null;
  /** When task was archived locally (UI-only state) */
  archivedAt?: Date | null;
  /** Whether this task was unplanned (reactive work vs proactive planning) */
  isUnplanned?: boolean;
  /**
   * The task is not planned for today: it is held by kan-do but in no column of the board (#353). Absent =
   * planned, so data stored before #353 loads as it was. Valid only while `status` is Open; read it through
   * `isNotPlanned()` (`lib/taskPlanning.ts`), never directly. kan-do's own state: a fetch never carries it, and
   * `mergeTasks` keeps it for a task it already holds unless the source's own planning state changed
   * (`sourceNotPlanned`, #357). Not `isUnplanned` (ad-hoc work).
   */
  notPlanned?: true;
  /**
   * What the task's source holds it as while the source holds it as not planned (#357): the Notion status name
   * (one of the mapped "not planned" statuses). Absent = the source holds it as planned, or holds no planning at
   * all (Local, Todoist). Set by a fetch and by the user's own plan / put-back of a task whose source stores
   * planning (`useTaskSync`), dropped by every status write that drops the marker (`markerSurvives`: that write
   * tells the source the column). `mergeTasks` changes `notPlanned` only when the fetched value's presence differs
   * from this one, so kan-do's own moves survive a sync. Additive: older data has none.
   */
  sourceNotPlanned?: string;
  /**
   * What Apple Reminders holds of a `reminders` task (#551, ADR 015 addendum "Reminders source"): the due date as
   * components (`date` is the date Reminders holds now), the recurrence rule (`FREQ=WEEKLY;INTERVAL=2`, informational)
   * and the list the reminder lives in (its role decides topic or activity, and whether a write is allowed). Set by the
   * adapter on every fetch; absent on every other source. Additive: older data has none.
   */
  reminders?: TaskReminders;
  /** Unpushed local changes (absent = the source holds the task as it is). A Local task never has one. */
  pendingSync?: PendingSync;
  /** A move to another source that did not finish; always together with `pendingSync` */
  pendingMove?: PendingMove;
}

/**
 * @deprecated TaskClass is unused in the codebase. Use plain objects conforming to Task interface instead.
 * This class will be removed in a future version.
 */
class TaskClass implements Task {
  id: string;
  source: SourceId;
  externalId: string | null;
  status: TaskStatus;
  title: string;
  activity: string | null;
  topic: string | null;
  topicColorCode: string | null;
  priority: number;
  notes: string | null;
  timeBoxSeconds: number | null;
  timeSpentSeconds: number | 0;
  timerId: number | null;
  custom?: Record<string, TaskCustomEntry>;
  completedAt?: Date | null;
  archivedAt?: Date | null;
  isUnplanned?: boolean;
  pendingSync?: PendingSync;
  pendingMove?: PendingMove;

  constructor(title: string) {
    this.id = Math.random().toString(36).substring(7);
    this.source = 'local';
    this.externalId = null;
    this.title = title;
    this.notes = null;
    this.status = TaskStatus.Open;
    this.priority = DEFAULT_PRIORITY;
    this.timeBoxSeconds = null;
    this.timeSpentSeconds = 0;
    this.topic = null;
    this.topicColorCode = null;
    this.activity = null;
    this.timerId = null;
    this.custom = {};
    this.completedAt = null;
    this.archivedAt = null;
    this.isUnplanned = false;
  }
}

// Exporting the type using 'export type' is necessary because we want to export the 'Task' type. 'export default' would export an actual runtime value and TypeScript types are purely a compile-time construct and are never present at runtime.
export { type Task, TaskClass, TaskStatus };
