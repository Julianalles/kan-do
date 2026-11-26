import { TaskStatus } from "~/types/taskStatus";
import type { CreateUncertain, PendingClear, Task } from "@/types/task";
import { useTaskSources } from '~/composables/useTaskSources';
import { SourceNotConfiguredError, SourceReadOnlyError } from '~/integrations/sources/types';
import { useTasksStore } from "~/store/tasks";
import { useIntegrationHealthStore } from "~/store/integrationHealth";
import { useTaskStatisticsStore } from "~/store/taskStatistics";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { informUnreachable } from '~/composables/useUnreachableNotice';
import { isNetworkError } from '~/lib/errorMessages';
import { mapHelpers } from '~/utils/mapHelpers';
import type { PendingTaskDelete } from '~/store/tasks';
import { isIntegrationSourceId, sourceCan, sourceSyncsTime, SETUP_ERROR_CONTEXTS } from '~/lib/taskSources';
import { CreateWaitingError, classifySyncFailure, createFailureKind, createOutcomeUnknown, isCreateWaiting, pushFailureScope, rateLimitOf } from '~/lib/integrationHealth';
import { useBoardStore } from '~/store/board';
import type { IntegrationSourceId, SourceId } from '~/types/taskSource';
import { notifyTaskMoveRejected } from '~/lib/taskMoveEvents';
import { useTrashStore } from '~/store/trash';
import type { TrashEntry } from '~/types/trash';
import { completedAtForDay } from '~/lib/doneDay';
import { isWritesFrozen } from '~/lib/dataStorage';
import { canBeOffToday, inStatus, isNotPlanned } from '~/lib/taskPlanning';

/** Where a source's setup problems are reported (the context picks the localized message). */
const setupContextOf = (source: IntegrationSourceId) => SETUP_ERROR_CONTEXTS[source];

/**
 * The fields an edit empties that held a value (#780): the time box and the ad-hoc marker. Only these clears are
 * written to a source; a field that was already empty (a value the source holds but kan-do could not read) is not one.
 */
const clearsOf = (before: Task, updates: Partial<Task>): PendingClear[] => [
  ...('timeBoxSeconds' in updates && (before.timeBoxSeconds ?? 0) > 0 && !((updates.timeBoxSeconds ?? 0) > 0) ? ['timeBox' as const] : []),
  ...('isUnplanned' in updates && before.isUnplanned === true && updates.isUnplanned !== true ? ['unplanned' as const] : []),
];

/** The fields (of an edit, or of a task) that hold a value, so no clear of them is to be written (#780). */
const setAgainOf = (fields: Partial<Task>): PendingClear[] => [
  ...((fields.timeBoxSeconds ?? 0) > 0 ? ['timeBox' as const] : []),
  ...(fields.isUnplanned === true ? ['unplanned' as const] : []),
];

/** Outcome of committing a pending delete upstream (#99). */
export type DeleteCommitResult = 'committed' | 'queued' | 'restored' | 'skipped';

/** How a commit of a pending move ended (#322). */
export type MoveCommitResult = 'committed' | 'queued' | 'reverted' | 'skipped';

/** Pending deletes whose upstream call is in flight (one per task, across composable instances). */
const deletesInFlight = new Set<string>();
/** Trash entries whose restore is under way: a fetch must not hand them a landed page meanwhile (#545). */
const restoresInFlight = new Set<string>();

/** Pending moves whose upstream calls are in flight (one per task, across composable instances). */
const movesInFlight = new Set<string>();

/**
 * Upstream status writes in flight, one chain per task, shared by every composable instance of a
 * Pinia app (keyed by its tasks store). A write waits for the previous one of the same task, so an
 * undo can never reach upstream before the completion it reverts (#150: a stack's writes are queued
 * for seconds).
 */
const statusWritesByStore = new WeakMap<object, Map<string, StatusWrite>>();

/**
 * Upstream pushes (`runSync`) in flight, one chain per task, per Pinia app. A push waits for the one before
 * it and sends the task as it is by then, so two overlapping triggers (the periodic retry and a refresh, a
 * reconnect and a manual sync) never create an offline-made task twice: the second sees its id and updates.
 */
const pushesByStore = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * Creates and restores of a source in flight (a page may be on its way), per Pinia app (#578). A removal of a page
 * waits for them: the page may be the one such a write is about to store on its task, and a removal that archived it
 * first would leave that task on an archived page. In memory only.
 */
const sourceWritesByStore = new WeakMap<object, Map<SourceId, number>>();

/** The writes a plan started (#553, one run per plan call, shared by its tasks): what `whenPlanWritten` waits for. */
const planWritesInFlight = new Map<string, Promise<void>>();

/**
 * How long a source's pushes pause after a 429 that named no wait (#529): the public instance's Worker answers 60 s,
 * Notion's own limit is per minute.
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * When a source's push pause ends (epoch ms), per Pinia app (#529). A 429 is a limit on the whole source, so one
 * request that gets it stops every push loop for that source until the window has passed. In memory only: after a
 * restart the first request finds the limit again.
 */
const rateLimitsByStore = new WeakMap<object, Map<SourceId, number>>();

/**
 * One queued or running status write. What the source holds is not kept here: the task's `pendingSync` marker is
 * the one record of it (#781), set before the write waits and updated by every push that lands meanwhile.
 */
interface StatusWrite {
  promise: Promise<void>;
}

/**
 * Network failures queue the delete instead of restoring the task. NotionClientAPI wraps fetch
 * failures and timeouts as NotionAPIError with statusCode 0 ("Network error"), which the generic
 * message matcher does not recognise.
 */
const isDeleteNetworkFailure = (error: unknown): boolean =>
  isNetworkError(error) || (error as { statusCode?: number } | null)?.statusCode === 0;

/** "Not found" upstream means the task is already gone: the delete has reached its goal. */
const isAlreadyGone = (error: unknown): boolean => {
  const status = (error as { statusCode?: number; httpStatusCode?: number } | null);
  return status?.statusCode === 404 || status?.httpStatusCode === 404;
};

/** A create-doubt step (#538: the lookup or the removal) failed without a request that could change anything: the delete or move waits. */
const isDoubtNotSettled = (error: unknown): boolean => (error as { createNotSent?: unknown } | null)?.createNotSent === true;

/**
 * Composable for handling task synchronization with external integrations
 */
export interface IUpdateStatusPayload {
  taskId: string;
  status: TaskStatus;
  operationVersion?: number;
  skipLocalUpdate?: boolean;
  /** The local change applies at once; the upstream write waits until this has settled (#150) */
  after?: Promise<unknown>;
  /**
   * A write of a batch (#529): inside a 429 window of its source the task is not sent, it keeps its new status and
   * its marker and goes out with the next push after the window. A single user-made write leaves this off and sends.
   */
  holdWhenRateLimited?: boolean;
}

export const useTaskSync = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const tasksStore = useTasksStore();
  const { adapterFor } = useTaskSources();
  const statisticsStore = useTaskStatisticsStore();
  const { handleError } = useErrorHandler();
  const health = useIntegrationHealthStore();
  const boardStore = useBoardStore();
  const statusWritesInFlight = statusWritesByStore.get(tasksStore) ?? new Map<string, StatusWrite>();
  statusWritesByStore.set(tasksStore, statusWritesInFlight);
  const pushesInFlight = pushesByStore.get(tasksStore) ?? new Map<string, Promise<boolean>>();
  pushesByStore.set(tasksStore, pushesInFlight);
  const rateLimitedUntil = rateLimitsByStore.get(tasksStore) ?? new Map<SourceId, number>();
  rateLimitsByStore.set(tasksStore, rateLimitedUntil);
  const sourceWritesInFlight = sourceWritesByStore.get(tasksStore) ?? new Map<SourceId, number>();
  sourceWritesByStore.set(tasksStore, sourceWritesInFlight);

  /**
   * A create or restore of `source` starts (#578): removals of its pages wait until the returned function runs. Call it
   * after the write's local settle step (the page stored on its task) and on every way out; calling it twice is safe.
   */
  const beginSourceWrite = (source: SourceId): (() => void) => {
    sourceWritesInFlight.set(source, (sourceWritesInFlight.get(source) ?? 0) + 1);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const left = (sourceWritesInFlight.get(source) ?? 1) - 1;
      if (left > 0) sourceWritesInFlight.set(source, left);
      else sourceWritesInFlight.delete(source);
    };
  };

  /**
   * What a removal of `page` (a card's page, or a move's origin page) may do (#578). Archiving is the one step here
   * nothing takes back, so it only ever fires less: 'skip' when another live card holds the page (the waiting task of
   * a write that stored the page a fetch had made a stray card of, #555: the page is its own, and no fetch may skip it
   * as deleted), 'hold' while a create or restore of the source is in flight (the page may be the one it is about to
   * store), otherwise 'send'.
   */
  const removalVerdict = (page: Pick<Task, 'source' | 'externalId'>): 'send' | 'hold' | 'skip' => {
    if (page.externalId === null) return 'send';
    if (tasksStore.holdsPage(page.source, page.externalId)) return 'skip';
    return sourceWritesInFlight.has(page.source) ? 'hold' : 'send';
  };

  /** Whether `source` is inside the window a 429 named (#529): nothing is sent to it, its tasks keep their marker. */
  const isRateLimited = (source: SourceId): boolean => {
    const until = rateLimitedUntil.get(source);
    if (until === undefined) return false;
    if (Date.now() < until) return true;
    rateLimitedUntil.delete(source);
    return false;
  };

  /** A failed request that was a 429 pauses the pushes of its source; any other failure changes nothing. */
  const noteRateLimit = (source: SourceId, error: unknown): void => {
    const limit = rateLimitOf(error);
    if (!limit || source === 'local') return;
    const until = Date.now() + (limit.retryAfterMs ?? RATE_LIMIT_WINDOW_MS);
    rateLimitedUntil.set(source, Math.max(until, rateLimitedUntil.get(source) ?? 0));
  };

  /**
   * Updates a task's status and syncs with the appropriate integration
   */
  const updateTaskStatus = async (payload: IUpdateStatusPayload): Promise<void> => {
    const taskToUpdate = tasksStore.task(payload.taskId);
    if (!taskToUpdate) {
      handleError(`Task with id ${payload.taskId} not found`, 'task_sync');
      return;
    }

    const previousState = taskToUpdate.status;
    // Every status write bumps the version, so the response of an older write of this task counts
    // as stale and cannot flip a newer status back (#150). Callers that bumped it pass theirs.
    const operationVersion = payload.operationVersion ?? tasksStore.incrementTaskOperationVersion(payload.taskId);

    // Skip local update if requested (e.g., for batch operations)
    if (!payload.skipLocalUpdate) {
      // Prepare updates object
      const updates: Partial<Task> = {
        status: payload.status,
        title: taskToUpdate.title || "",
      };

      // Track completion timestamp when moved to Done
      if (payload.status === TaskStatus.Done && previousState !== TaskStatus.Done) {
        updates.completedAt = new Date();
        if (import.meta.dev) {
          console.log(`Task ${payload.taskId} marked done at ${updates.completedAt.toISOString()}`);
        }
      }

      // Clear completion timestamp if moved out of Done
      if (payload.status !== TaskStatus.Done && previousState === TaskStatus.Done) {
        updates.completedAt = null;
        if (import.meta.dev) {
          console.log(`Task ${payload.taskId} moved out of done, cleared completedAt`);
        }
      }

      // Update task in store using proper action
      tasksStore.updateTask(payload.taskId, updates);
    }

    // A Wartet task off today (#793) moved back to Offen is still off today: a source that stores planning gets its "not
    // planned" status written (#798, as the put-back of an Offen task does), not `today`. Only from Wartet: an Offen task
    // that stays off today without a held status (no status mapped when it was put back) stays written as `today` (#357)
    if (previousState === TaskStatus.Waiting && payload.status === TaskStatus.Open) {
      const live = tasksStore.task(payload.taskId);
      const hold = live && live.source !== 'local' && isNotPlanned(live) && live.sourceNotPlanned === undefined
        ? adapterFor(live.source).notPlannedHold?.() ?? null
        : null;
      if (hold !== null) tasksStore.setSourceNotPlanned(payload.taskId, hold);
    }

    // The source does not hold the new status yet: the task carries the marker until a write went through,
    // also while this write waits for an earlier one (#319). The marker notes whether the source holds the task
    // as completed (the status before this change), so a replay after a restart can still reopen it (#344).
    tasksStore.markPendingSync(payload.taskId, previousState === TaskStatus.Done);

    // Get updated task for sync and statistics
    const updatedTask: Task = tasksStore.task(payload.taskId)!;

    // Handle statistics recording/updating/removal based on status changes
    const isArchived = tasksStore.archivedTaskIds.includes(payload.taskId);
    
    if (!isArchived) {
      // Only update statistics for non-archived tasks
      if (payload.status === TaskStatus.Done && previousState !== TaskStatus.Done) {
        // Task moved TO Done: record completion
        try {
          statisticsStore.recordTaskCompletion(updatedTask);
        } catch (error) {
          console.warn('Failed to record task completion statistics:', error);
        }
      } else if (payload.status !== TaskStatus.Done && previousState === TaskStatus.Done) {
        // Task moved OUT of Done: remove from statistics
        try {
          statisticsStore.removeTaskRecord(payload.taskId);
          if (import.meta.dev) {
            console.log(`Removed task ${payload.taskId} from statistics (moved out of Done)`);
          }
        } catch (error) {
          console.warn('Failed to remove task from statistics:', error);
        }
      } else if (payload.status === TaskStatus.Done && previousState === TaskStatus.Done) {
        // Task still in Done but status changed (e.g., dragged within Done column): update record
        try {
          statisticsStore.updateTaskRecord(updatedTask);
          if (import.meta.dev) {
            console.log(`Updated statistics for task ${payload.taskId} (still in Done)`);
          }
        } catch (error) {
          console.warn('Failed to update task statistics:', error);
        }
      }
    }

    // Sync with external integration (pass operation version to prevent stale updates). The write
    // waits for `after` and for an earlier write of the same task, then sends the task as it is by
    // then: a snapshot taken before the wait would overwrite edits made meanwhile, and a status that
    // was changed again (an undone completion) is sent as that newer status.
    // Pin the new status against refresh merges until its write is done. A new token supersedes an
    // older pin (an earlier stack drop or undo), so a merge cannot revert to the old status.
    const lock = tasksStore.lockTaskStatus(payload.taskId);
    const earlier = statusWritesInFlight.get(payload.taskId);
    const waitFor = [payload.after, earlier?.promise].filter((p) => p !== undefined);
    const entry: StatusWrite = { promise: Promise.resolve() };
    entry.promise = (async () => {
      if (waitFor.length > 0) await Promise.allSettled(waitFor);
      const current = tasksStore.task(payload.taskId);
      if (!current) return;
      // The marker is set above and stays: the push after the window sends the status (#529)
      if (payload.holdWhenRateLimited && isRateLimited(current.source)) return;
      // What the source holds comes from the marker, not from this move's `previousState`: a push that ran while this
      // write waited (an edit, a done day, a retry) may already have sent the new status (#781)
      await runSync(current, operationVersion);
    })();
    statusWritesInFlight.set(payload.taskId, entry);
    try {
      await entry.promise;
    } finally {
      if (statusWritesInFlight.get(payload.taskId) === entry) statusWritesInFlight.delete(payload.taskId);
      tasksStore.unlockTaskStatus(payload.taskId, lock);
    }
  };

  /**
   * Sets the done day of a done task (kd#131: it was marked done a day or more late). `day` is a local
   * `YYYY-MM-DD`; the limits and the stored time of day are `lib/doneDay` (not in the future, not before the
   * task was created, the completion's own time of day kept). The task, its completion record and so every
   * reader (statistics, done today / before today, the yesterday note, the recap, the Erledigt order) move at
   * once; time spent and work sessions stay as recorded. The task is then pushed like any edit: a source that
   * stores a completion date receives it through its adapter, and the `completedAtCorrected` marker keeps the
   * day locally over whatever a source returns.
   * @returns the stored completion time, or null when nothing changed (unknown or not done task, a day outside the limits)
   */
  const setCompletedDay = (taskId: string, day: string, now: Date = new Date()): Date | null => {
    const task = tasksStore.task(taskId);
    if (!task || task.status !== TaskStatus.Done) return null;
    const completedAt = completedAtForDay(task, day, now);
    if (!completedAt) return null;

    const operationVersion = tasksStore.incrementTaskOperationVersion(taskId);
    if (!tasksStore.setCompletedAt(taskId, completedAt)) return null;
    const updated = tasksStore.task(taskId)!;
    // An existing record moves, archived or not; a done task without one gets it by the backfill rules
    if (!statisticsStore.setCompletionDate(taskId, completedAt)) {
      statisticsStore.syncExistingDoneTasks([updated], tasksStore.archivedTaskIds);
    }
    void runSync(updated, operationVersion);
    return completedAt;
  };

  /**
   * Moves several tasks to `status` (a whole stack dropped in a column, #150). Every task changes
   * locally at once, synchronously, so the board settles in one render; the upstream writes then run
   * one after another (Notion rate limits), and one failing write does not stop the others (it goes
   * through the per-task error path). Unknown ids are skipped.
   */
  const updateTaskStatuses = async (taskIds: readonly string[], status: TaskStatus): Promise<void> => {
    let previous: Promise<void> = Promise.resolve();
    const writes: Array<Promise<void>> = [];
    for (const taskId of taskIds) {
      if (!tasksStore.task(taskId)) continue;
      // updateTaskStatus pins the status against merges until its own write is done
      previous = updateTaskStatus({ taskId, status, after: previous, holdWhenRateLimited: true });
      writes.push(previous);
    }
    // Every write has finished before this resolves; a failure that escaped one of them (the
    // per-task error path handles the usual ones) is rethrown for the caller to report
    const failed = (await Promise.allSettled(writes)).find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  };

  /**
   * Creates a task in `source` and puts it on the board (#321): the add form's only way to make a task.
   * Local gets a generated `local_…` id and no `externalId`; an integration creates it through its adapter and
   * the task keeps the id the integration returns. When the source needs attention or the browser is offline
   * the adapter is not called: the task is made here with a generated `id`, no `externalId` and the
   * `pendingSync` marker, and the next push creates it upstream (`pushTask`), which gives it its `externalId`
   * and never changes the `id`. A create that fails for transient reasons (no connection, a rejected token, 403,
   * a 429 rate limit, a 5xx; `createFailureKind`) takes the same path, by the push rules (`reportPushFailure`): a source fault (no
   * connection, a missing setup, 401) is recorded in the source's health, anything else (403, 429, 5xx) only in the
   * task's marker, and the first failure that is not plain offline is reported once. A rejected create (400, 409,
   * 404, any other 4xx: the source refuses this task) throws, the caller keeps the form open and reports it.
   * A draft with `notPlanned: true` and the status Open makes a task that is not planned (#367: one made while the
   * place "Alle" shows): it goes on top of "Alle Aufgaben" instead of into Offen. The marker is set here, after the
   * adapter returned the task. A source that stores planning (#357, `notPlannedHold`: Notion with a "not planned"
   * status mapped) creates the task as not planned there too; for every other source nothing about it is written.
   * `options.onAdd` runs with the task right before it enters the store, in the same tick (#758).
   * @returns the task as it was added to the store
   */
  const createTask = async (draftIn: Partial<Task>, source: SourceId, options: { onAdd?: (task: Task) => void } = {}): Promise<Task> => {
    // A source that is read-only in kan-do (#551) never gets a task from here, not even a queued one
    if (source !== 'local' && !sourceCan(source, 'create')) throw new SourceReadOnlyError(source, 'creating a task');
    const { notPlanned: asksNotPlanned, sourceNotPlanned: _held, ...plain } = draftIn;
    const hold = asksNotPlanned === true && (plain.status === undefined || plain.status === TaskStatus.Open)
      ? adapterFor(source).notPlannedHold?.() ?? null
      : null;
    // The adapter reads both: the marker says "not planned", the held value says as what
    const draft: Partial<Task> = hold === null ? plain : { ...plain, notPlanned: true, sourceNotPlanned: hold };
    let created: Task;
    let deferredReason: string | null = null;
    let deferredError: unknown = null;
    // Put aside without a request because the source cannot be reached (browser offline, source known offline)
    let deferredUnreachable = false;
    let createAttemptedAt = 0;
    // Removals of the source's pages wait while its create is in flight, until the page sits on the board (#578)
    let endWrite: () => void = () => {};
    let notPlanned: boolean;

    try {
      if (source === 'local') {
        created = await adapterFor('local').create(draft);
      } else if (health.needsAttention(source)) {
        deferredReason = health.healthOf(source).lastError ?? 'Source needs attention';
        deferredUnreachable = health.isOffline(source);
        created = { ...(await adapterFor('local').create(draft)), source };
      } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        deferredReason = 'Offline';
        deferredUnreachable = true;
        created = { ...(await adapterFor('local').create(draft)), source };
      } else if (isRateLimited(source)) {
        // A 429 paused the source (#529): the create waits behind the marker like one made offline
        deferredReason = 'Rate limited';
        created = { ...(await adapterFor('local').create(draft)), source };
      } else {
        createAttemptedAt = Date.now();
        endWrite = beginSourceWrite(source);
        try {
          created = await adapterFor(source).create(draft);
        } catch (error) {
          if (!isIntegrationSourceId(source) || createFailureKind(error) !== 'transient') throw error;
          deferredError = error;
          deferredReason = error instanceof Error ? error.message : String(error);
          created = { ...(await adapterFor('local').create(draft)), source };
        }
      }

      // Only a task created in Offen starts not planned: add-and-start (Jetzt) stays on the board
      notPlanned = asksNotPlanned === true && created.status === TaskStatus.Open;
      if (notPlanned) created = { ...created, notPlanned: true, ...(hold !== null ? { sourceNotPlanned: hold } : {}) };
      else {
        if (created.notPlanned !== undefined) delete created.notPlanned;
        if (hold !== null) delete created.sourceNotPlanned;
      }
      // A fetch that landed while the create was in flight made a card of the page (#555): this task replaces it
      dropLandedCards(created.source, created.externalId);
      // In the same tick as the add, so the caller can act before the board first renders the task (#758: the in-card flow hides it)
      options.onAdd?.(created);
      tasksStore.addTask(created);
    } finally {
      endWrite();
    }
    if (notPlanned) boardStore.noteNotPlanned(created.id);
    else if (created.status !== undefined) boardStore.updateTaskPosition(created.id, created.status);
    if (deferredReason !== null) {
      tasksStore.markPendingSync(created.id);
      // The create may have made the page (a timeout, a 5xx, #528): the next push looks for it before it creates
      if (deferredError !== null && createOutcomeUnknown(deferredError)) {
        tasksStore.markCreateUncertain(created.id, createAttemptedAt, draft.title || 'Untitled');
      }
      if (deferredError === null || !isIntegrationSourceId(source)) {
        tasksStore.recordPendingSyncFailure(created.id, deferredReason);
        // No request was sent, so no failure reports it: the outage is still told once (#851)
        if (deferredUnreachable && isIntegrationSourceId(source)) informUnreachable(source);
      } else if (classifySyncFailure(deferredError) === 'offline') {
        // Plain offline is no error: the cloud and the sync button show it, and the outage is told once (#851)
        tasksStore.recordPendingSyncFailure(created.id, deferredReason);
        health.recordFailure(source, deferredError);
        informUnreachable(source);
      } else {
        // The form closes as on success, so a failure the user could not otherwise see is reported once
        // (the marker holds no failure yet, so this counts as the first); it records the marker's reason
        reportPushFailure(created, deferredError, 'task_create');
      }
    }
    return created;
  };

  /**
   * Edits fields of a stored task and pushes it to its own source, as the sheet's field edits do: a new operation
   * version (a stale response of an earlier write cannot overwrite the edit), the store at once, then `runSync`
   * (one push per task at a time, the `pendingSync` marker until the source holds it). The in-card flow writes each
   * answer through this once its task is stored (#758). Resolves like `runSync`; false for an unknown id. A source
   * that stores none of these fields and only the done state (Todoist) writes nothing for it (#781: its adapter writes
   * only a change of the done state the marker records).
   */
  const editTask = (taskId: string, updates: Partial<Task>): Promise<boolean> => {
    const before = tasksStore.task(taskId);
    if (!before) return Promise.resolve(false);
    const clears = clearsOf(before, updates);
    const operationVersion = tasksStore.incrementTaskOperationVersion(taskId);
    tasksStore.updateTask(taskId, updates);
    // The clear goes onto the marker at once (#780), so a push that waits (an earlier push, a status write) or a move's
    // undo window cannot lose it to a restart or an undo; with no marker yet the push notes it as it sets one. A
    // field set again needs no clear any more, even when the push that notes it is still waiting
    tasksStore.noteClears(taskId, { add: clears, drop: setAgainOf(updates) });
    // A status write of the task still waiting (a stack drop chains them) sends the task as it is by then, the edit
    // with it, so the edit's own push goes after it (#770). It waits outside `pushesInFlight` (the status write's own
    // push waits on that) and again for a status write queued meanwhile
    if (!statusWritesInFlight.has(taskId)) return runSync(tasksStore.task(taskId)!, operationVersion, clears);
    return (async () => {
      let statusWrite: Promise<void> | undefined;
      while ((statusWrite = statusWritesInFlight.get(taskId)?.promise) !== undefined) await statusWrite.catch(() => undefined);
      const live = tasksStore.task(taskId);
      return live ? runSync(live, operationVersion, clears) : true;
    })();
  };

  /**
   * Syncs a task to the adapter of its own source
   * Local tasks have no upstream - they are already persisted via Pinia
   */
  const syncTaskToIntegration = async (task: Task, operationVersion?: number): Promise<void> => {
    await runSync(task, operationVersion);
  };

  /**
   * Same as `syncTaskToIntegration`; resolves to whether the source now holds the task: false when the
   * write failed or was not sent because the integration is not set up, true when it went through or the
   * task is Local. The task carries `pendingSync` from before the write until it succeeded (#319); a change
   * made while the write is in flight keeps the marker.
   */
  const runSync = async (task: Task, operationVersion?: number, clears: readonly PendingClear[] = []): Promise<boolean> => {
    // Local tasks: no external sync needed, they are persisted via Pinia
    if (task.source === "local") {
      return true;
    }

    // Inside its undo window a move creates nothing upstream (#322); the commit after the window sends the
    // task as it is by then, so the change that triggered this push is not lost
    if (tasksStore.isMoveHeld(task.id)) return false;

    // One push per task at a time: a later one waits and then sends the task as it is, with the id a
    // create that just finished gave it (updates are idempotent, creates are not)
    const earlier = pushesInFlight.get(task.id);
    const push = (async (): Promise<boolean> => {
      let target = task;
      if (earlier) {
        await earlier.catch(() => undefined);
        const live = tasksStore.task(task.id);
        // Deleted while the earlier push ran: nothing left to push
        if (!live) return true;
        target = live;
      }
      // A moved task whose page is not created yet is created by the move, which also removes the origin copy
      if (target.pendingMove && target.externalId === null) {
        tasksStore.markPendingSync(target.id);
        return (await commitTaskMove(target.id)) === 'committed';
      }
      return pushTask(target, operationVersion, clears);
    })();
    pushesInFlight.set(task.id, push);
    try {
      return await push;
    } finally {
      if (pushesInFlight.get(task.id) === push) pushesInFlight.delete(task.id);
    }
  };

  /**
   * A create or restore resolved with a page (#555): the cards a fetch made of that page while the write was in flight
   * are dropped (`tasksStore.dropLandedDuplicates`), and so are their statistics records. `exceptTaskId` is the task
   * that waited; a task not on the board yet passes none.
   */
  const dropLandedCards = (source: SourceId, externalId: string | null | undefined, exceptTaskId?: string): void => {
    forgetDroppedCards(tasksStore.dropLandedDuplicates(source, externalId, exceptTaskId));
  };

  /** The statistics records of cards that were dropped as duplicates of another card of the same page. */
  const forgetDroppedCards = (ids: readonly string[]): void => {
    for (const id of ids) {
      try { statisticsStore.removeTaskRecord(id); } catch (error) { console.warn('Failed to remove statistics of a duplicate:', error); }
    }
  };

  /**
   * Whether a write of the task is under way or waits for an earlier one. A fetch that is merged meanwhile may
   * have read the source before that write and must not take the task for gone (`mergeTasks`' `pushing`, #357).
   */
  const isPushing = (taskId: string): boolean => pushesInFlight.has(taskId) || statusWritesInFlight.has(taskId) || restoresInFlight.has(taskId);

  /** `timeEdited` for a write that carries a total the user set (kd#4), even at 0; empty otherwise. */
  const timeEditFlag = (taskId: string): { timeEdited?: true } =>
    tasksStore.pendingTimeUpdates[taskId]?.absolute === true ? { timeEdited: true } : {};

  /** `clears` for a write whose marker holds fields the user emptied (#780); empty otherwise. */
  const clearFlag = (taskId: string): { clears?: PendingClear[] } => {
    const clears = tasksStore.task(taskId)?.pendingSync?.clears;
    return clears && clears.length > 0 ? { clears: [...clears] } : {};
  };

  /** One write of a non-Local task; never rejects, a failure goes to `reportPushFailure`. */
  const pushTask = async (task: Task, operationVersion?: number, clears: readonly PendingClear[] = []): Promise<boolean> => {
    // The marker records what the source holds (#781): a status change sets it before any write, so a task without one
    // is held in its local status, and a new marker takes that
    const revision = tasksStore.markPendingSync(task.id);
    // The user's clears go onto the marker (#780), so a failed write, an offline edit or a restart still sends them;
    // one the task no longer shows empty (set again while this push waited) is left out
    const live = tasksStore.task(task.id);
    if (live) tasksStore.noteClears(task.id, { add: clears.filter((field) => !setAgainOf(live).includes(field)) });
    const queuedTime = mapHelpers.has(tasksStore.pendingTimeUpdates, task.id);
    if (queuedTime) tasksStore.markPendingUpdateSyncing(task.id);
    let createAttemptedAt = 0;
    let endWrite: () => void = () => {};

    try {
      const adapter = adapterFor(task.source);
      if (task.externalId === null) {
        // Made while the source was unreachable: it creates the task now and gives it its id
        createAttemptedAt = Date.now();
        endWrite = beginSourceWrite(task.source);
        const created = await adapter.create(task, { claimedExternalIds: tasksStore.claimedPages(task.source) });
        // Read before `completeCreate`, which drops the revision
        const timeSuperseded = tasksStore.pendingSyncRevision(task.id) !== revision;
        forgetDroppedCards(tasksStore.completeCreate(task.id, created, revision));
        applySyncedTask(task.id, created, operationVersion, timeSuperseded);
      } else {
        // What the source holds comes from the marker (it survives a restart, #344; `markPendingSync` above always
        // leaves the answer). `Open` only stands for "not completed" here.
        const heldDone = tasksStore.task(task.id)?.pendingSync?.upstreamDone;
        const sentDone = task.status === TaskStatus.Done;
        const carried = clearFlag(task.id);
        const synced = await adapter.update(task, {
          ...(heldDone === undefined ? {} : { previousStatus: heldDone ? TaskStatus.Done : TaskStatus.Open }),
          // A total the user set (kd#4) is written even at 0; the entry lives until the push carried it
          ...timeEditFlag(task.id),
          ...carried,
        });
        if (synced) applySyncedTask(task.id, synced, operationVersion, tasksStore.pendingSyncRevision(task.id) !== revision);
        // Written: a marker that stays for a newer change must not send these clears again (#780)
        if (carried.clears) tasksStore.noteClears(task.id, { drop: carried.clears });
        tasksStore.clearPendingSync(task.id, revision, sentDone);
      }
      restoreSourceAfterPush(task.source);
      return true;
    } catch (error) {
      if (queuedTime) tasksStore.markPendingUpdateFailed(task.id, error instanceof Error ? error.message : String(error));
      // A create in doubt that may still land (#528): not a failure, the next push looks again
      if (isCreateWaiting(error)) return false;
      if (createAttemptedAt > 0 && createOutcomeUnknown(error)) tasksStore.markCreateUncertain(task.id, createAttemptedAt, task.title || 'Untitled');
      reportPushFailure(task, error, `Failed to sync task ${task.id} to ${task.source}`);
      return false;
    } finally {
      endWrite();
    }
  };

  /** Whether an integration was taken off an onboarded board; a board without sources (tests, never onboarded) has none to miss. */
  const isDisconnected = (source: SourceId): boolean =>
    isIntegrationSourceId(source) && boardStore.boardConfig.sources !== null && !boardStore.isIntegrationConnected(source);

  /** A write went through, so the source is reachable again: a push-only recovery needs no fetch to show it (#319). */
  const restoreSourceAfterPush = (source: SourceId): void => {
    // A write went through, so the limit has lifted
    rateLimitedUntil.delete(source);
    if (isDisconnected(source)) return;
    if (!isIntegrationSourceId(source)) return;
    // Its outage is over: the next one is told again (#851)
    health.noteReachable(source);
    if (health.needsAttention(source)) health.markHealthy(source);
  };

  /**
   * A write failed: the task keeps its marker (with the reason). Only a failure that is the source's own (no
   * connection, not set up, a rejected token) is recorded in the source's health; a page the source refuses
   * (400, 403, 404, a 5xx on that request) stays the task's problem (#319). The user hears about it once: a
   * task whose marker already holds a failure is a retry and stays quiet, and so does a source that is already
   * known to be down, however often a refresh resets its health in between. No setup dialog opens by itself:
   * the sync button's popover offers the repair.
   */
  const reportPushFailure = (task: Task, error: unknown, syncContext: string): void => {
    // A 429 limits the whole source: the loops stop sending to it until the window has passed (#529)
    noteRateLimit(task.source, error);
    // The source was disconnected while the push was in flight (#320): nobody is waiting for its health or a toast
    if (isDisconnected(task.source)) {
      console.error(`[TaskSync] ${syncContext} (source disconnected meanwhile):`, error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const retry = (tasksStore.task(task.id)?.pendingSync?.attempts ?? 0) > 0;
    tasksStore.recordPendingSyncFailure(task.id, message);
    if (!isIntegrationSourceId(task.source)) return;
    const sourceFault = pushFailureScope(error) === 'source';
    const alreadyKnown = retry || (sourceFault && health.needsAttention(task.source));
    if (!alreadyKnown) {
      if (error instanceof SourceNotConfiguredError && isIntegrationSourceId(error.source)) handleError(error.message, setupContextOf(error.source));
      else handleSyncError(error, syncContext, task.source);
    } else {
      console.error(`[TaskSync] ${syncContext}:`, error);
    }
    if (sourceFault) health.recordFailure(task.source, error);
  };

  /**
   * Merges what the source holds after a write (bidirectional sync: changes made directly in Notion,
   * e.g. adding tags, are preserved locally) unless a newer local write superseded this one.
   * `timerId` is preserved locally, never taken from the source. With `timeSuperseded` (the revision moved since the write started:
   * a timer checkpoint, #313) the echo holds an older total: the larger one stays.
   */
  const applySyncedTask = (taskId: string, synced: Task, operationVersion?: number, timeSuperseded = false): void => {
    const currentVersion = tasksStore.getTaskOperationVersion(taskId);
    if (operationVersion !== undefined && currentVersion !== operationVersion) {
      if (import.meta.dev) {
        console.log(`[TaskSync] Skipping stale update for task ${taskId}. Expected version ${operationVersion}, current is ${currentVersion}`);
      }
      return;
    }

    // A total the user set after this write started (kd#4) is not yet in the source: keep it over the echo
    const timeKept = tasksStore.pendingTimeUpdates[taskId]?.absolute === true;
    // A done day the user corrected (kd#131) stays while the source still holds the task as done: a source
    // without a completion date echoes "now"
    const live = tasksStore.task(taskId);
    const doneDayKept = live?.completedAtCorrected === true && live.status === TaskStatus.Done && synced.status === TaskStatus.Done;
    tasksStore.updateTask(taskId, {
      isUnplanned: synced.isUnplanned,
      ...(timeKept ? {} : { timeSpentSeconds: timeSuperseded ? Math.max(live?.timeSpentSeconds ?? 0, synced.timeSpentSeconds) : synced.timeSpentSeconds }),
      status: synced.status,
      priority: synced.priority,
      timeBoxSeconds: synced.timeBoxSeconds,
      topic: synced.topic,
      topicColorCode: synced.topicColorCode,
      activity: synced.activity,
      ...(doneDayKept ? {} : { completedAt: synced.completedAt }),
      custom: synced.custom,
      // What a source that writes a date handed back (#553: the date written and `wrote`); no other source has the field
      ...(synced.reminders ? { reminders: synced.reminders } : {}),
    });

    if (import.meta.dev) {
      console.log('[TaskSync] Updated local task with synced values:', taskId);
    }
  };

  const syncArchiveStatusForTasks = async (taskIds: string[]): Promise<void> => {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return;
    }

    const idsBySource = new Map<SourceId, string[]>();
    for (const taskId of taskIds) {
      const source = tasksStore.task(taskId)?.source;
      if (!source || source === "local") continue;
      idsBySource.set(source, [...(idsBySource.get(source) ?? []), taskId]);
    }

    for (const [source, sourceTaskIds] of idsBySource) {
      const adapter = adapterFor(source);
      if (!adapter.archivesAsStatus()) {
        continue;
      }

      // The archive is local at once and its marker is only set per task inside the loop: a loop that stops early
      // (a 429, a source that is down) marks the tasks it leaves, or no push would ever send their archive
      const markRest = (from: number): void => {
        for (const restId of sourceTaskIds.slice(from)) tasksStore.markPendingSync(restId);
      };

      for (const [index, taskId] of sourceTaskIds.entries()) {
        // A 429 limits the whole source (#529): the rest waits for the next push
        if (isRateLimited(source)) {
          markRest(index);
          break;
        }
        const task = tasksStore.task(taskId);
        if (!task) {
          continue;
        }

        // Never created upstream (made while the source was unreachable): the push creates it first
        if (task.externalId === null) {
          const pushed = await runSync(task);
          if (!pushed && (health.needsAttention(source) || isRateLimited(source))) {
            markRest(index + 1);
            break;
          }
          continue;
        }

        // Get current operation version to track this sync
        const operationVersion = tasksStore.getTaskOperationVersion(taskId);
        const revision = tasksStore.markPendingSync(taskId);

        try {
          // update returns the synced task with the source's current state
          // The write drops the queued time entry, so it has to carry a user-set total (kd#4)
          const carried = clearFlag(taskId);
          const syncedTask = await adapter.update(task, { ...timeEditFlag(taskId), ...carried });
          if (carried.clears) tasksStore.noteClears(taskId, { drop: carried.clears });
          tasksStore.clearPendingSync(taskId, revision);
          restoreSourceAfterPush(source);
          if (!syncedTask) continue;

          // Check if this response is stale before applying updates
          const currentVersion = tasksStore.getTaskOperationVersion(taskId);
          if (currentVersion !== operationVersion) {
            if (import.meta.dev) {
              console.log(`[TaskSync] Skipping stale archive sync update for task ${taskId}. Expected version ${operationVersion}, current is ${currentVersion}`);
            }
            continue;
          }

          // Update local store with synced values
          tasksStore.updateTask(taskId, {
            isUnplanned: syncedTask.isUnplanned,
            status: syncedTask.status,
            custom: syncedTask.custom,
          });
        } catch (error) {
          reportPushFailure(task, error, `Failed to sync archived task ${taskId}`);
          // A source that is down or not set up fails the same way for every other task
          if (pushFailureScope(error) === 'source') {
            markRest(index + 1);
            break;
          }
        }
      }
    }
  };

  /**
   * Pushes every task that carries `pendingSync` to its source (#319), the successor of the time-only
   * `syncPendingTimeUpdates`: a status change, notes, a new task and tracked time all wait behind the same
   * marker, and the adapter sends the task as it is now. Runs on a timer, on reconnect, on a manual refresh,
   * when a timer stops and after a fetch of a recovered source (`only` limits it to one source). A task whose
   * write is already in flight is left to that write. Local tasks need no push: they are persisted via Pinia.
   */
  /**
   * Sends the deletes that wait in the queue (`state: 'queued'`: their undo window is over and the trash entry exists)
   * to their source (#543). `commitTaskDelete` itself queues again, without a request, while the source is inside a
   * 429 window, so one request that meets the limit is the most a flush spends.
   */
  const commitQueuedDeletes = async (only?: SourceId): Promise<void> => {
    for (const pending of Object.values(tasksStore.pendingDeletes)) {
      if (pending.state !== 'queued' || deletesInFlight.has(pending.taskId)) continue;
      const sources = sourcesOfDelete(pending.task);
      if (sources.length === 0 || (only && !sources.includes(only))) continue;
      if (sources.some((source) => isRateLimited(source))) continue;
      await commitTaskDelete(pending.taskId);
    }
  };

  const syncPendingChanges = async (only?: SourceId): Promise<void> => {
    // After an app reset the stores still hold the erased state until the reload: never push it upstream (kd#227)
    if (isWritesFrozen()) return;
    // Time queued for a source that stores none (Local, Todoist) has nothing to push: it only lingered
    // until the stale cleanup (#336). New ticks of such tasks are not queued at all.
    for (const taskId of Object.keys(tasksStore.pendingTimeUpdates)) {
      const owner = tasksStore.task(taskId);
      if (owner && !sourceSyncsTime(owner.source)) tasksStore.clearPendingTimeUpdate(taskId);
    }

    // Deletes that wait (offline, a 429, #543) go before everything else; a source inside a 429 window sends none
    await commitQueuedDeletes(only);

    // Moves first: a moved task is created in its target before anything else is pushed for it
    await commitPendingMoves(only);

    const bySource = new Map<SourceId, Task[]>();
    for (const task of tasksStore.pendingSyncTasks) {
      if (task.source === "local" || (only && task.source !== only)) continue;
      if (statusWritesInFlight.has(task.id) || deletesInFlight.has(task.id) || pushesInFlight.has(task.id)) continue;
      bySource.set(task.source, [...(bySource.get(task.source) ?? []), task]);
    }

    for (const [source, sourceTasks] of bySource) {
      for (const task of sourceTasks) {
        // A 429 limits the whole source (#529): nothing more is sent until the window has passed; the tasks keep
        // their marker and their order for the next push
        if (isRateLimited(source)) break;
        const live = tasksStore.task(task.id);
        if (!live || !tasksStore.isSyncPending(live.id) || pushesInFlight.has(live.id)) continue;
        const pushed = await runSync(live);
        // A source that is down, rejects us or is failing fails the same way for every other task: try again
        // next time. A page the source refuses (the task's own failure) does not stop the others.
        if (!pushed && (health.needsAttention(source) || isRateLimited(source))) break;
      }
    }

    // Clean up stale pending updates
    tasksStore.cleanupStalePendingUpdates();
  };

  /**
   * Sends a delete to the task's source through its adapter. Notion: archive the page (restorable in
   * Notion's trash). Todoist: delete the task (not recoverable). Local, or a task its source never got to create: nothing upstream. Throws on failure.
   */
  const deleteTaskUpstream = async (pending: PendingTaskDelete): Promise<void> => {
    if (pending.task.source !== 'local' && !sourceCan(pending.task.source, 'remove')) throw new SourceReadOnlyError(pending.task.source, 'deleting a task');
    // Both verdicts come before the first removal (#578): a hold on the origin after the own page was archived would
    // make the next flush archive that page a second time
    // Made while its source was unreachable and never created there (#319): nothing upstream to remove
    const own = pending.task.externalId !== null ? pending.task : null;
    // Deleted while a move was outstanding (#322): the origin copy goes too, or the next fetch of the origin
    // would bring the task back
    const origin = originToRemove(pending.task);
    const ownVerdict = own ? removalVerdict(own) : null;
    const originVerdict = origin ? removalVerdict(origin) : null;
    // A write of the source may be about to store the page on a task: the delete waits, quietly
    if (ownVerdict === 'hold' || originVerdict === 'hold') throw new CreateWaitingError();
    for (const [page, verdict] of [[own, ownVerdict], [origin, originVerdict]] as const) {
      if (!page || verdict === null) continue;
      if (verdict === 'skip') {
        tasksStore.forgetDeletedPage(page.externalId!);
        continue;
      }
      try {
        await adapterFor(page.source).remove(page);
      } catch (error) {
        if (!isAlreadyGone(error)) {
          noteRateLimit(page.source, error);
          throw error;
        }
      }
    }
    // A create that may have landed (#538): the page it made goes with the task, or the next fetch brings it back
    for (const { source, doubt } of unsettledDoubts(pending.task)) {
      try {
        await settleCreateDoubt(source, doubt, pending.taskId);
      } catch (error) {
        noteRateLimit(source, error);
        throw error;
      }
    }
  };

  /** The creates of a deleted or moved task that may have landed and have no page id yet: its own and its move origin's (#538). */
  const unsettledDoubts = (task: Task): Array<{ source: SourceId; doubt: CreateUncertain }> => {
    const found: Array<{ source: SourceId; doubt: CreateUncertain }> = [];
    const own = task.pendingSync?.createUncertain;
    if (own && task.source !== 'local' && task.externalId === null) found.push({ source: task.source, doubt: own });
    const move = task.pendingMove;
    if (move?.fromCreateUncertain && move.fromExternalId === null && move.fromSource !== 'local') {
      found.push({ source: move.fromSource, doubt: move.fromCreateUncertain });
    }
    return found;
  };

  /**
   * Looks for the page of a create in doubt and removes it (#538, `TaskSourceAdapter.removeLanded`). Skipped for a
   * source without that (Todoist), one that is disconnected, and when another task holds a doubt of the same title: its
   * page could be that one's, and a page not identified as this task's is never archived. Throws while the create may
   * still land or when the lookup or removal failed; the caller keeps the delete or move queued.
   */
  const settleCreateDoubt = async (source: SourceId, doubt: CreateUncertain, ownerId: string): Promise<void> => {
    if (source === 'local' || isDisconnected(source)) return;
    const adapter = adapterFor(source);
    if (!adapter.removeLanded) return;
    if (tasksStore.hasCompetingDoubt(source, doubt.title, ownerId)) return;
    await adapter.removeLanded(doubt, { claimedExternalIds: tasksStore.claimedPages(source) });
  };

  /** The sources a pending delete still has work at: its own page, its move origin, a create that may have landed (#543, #538). */
  const sourcesOfDelete = (task: Task): SourceId[] => {
    const sources = new Set<SourceId>();
    if (task.source !== 'local' && task.externalId !== null) sources.add(task.source);
    const origin = originToRemove(task);
    if (origin) sources.add(origin.source);
    for (const { source } of unsettledDoubts(task)) sources.add(source);
    return [...sources];
  };

  /** The origin copy of a task with an outstanding move, as a task its adapter can remove; null when there is none. */
  const originToRemove = (task: Task): Task | null => {
    const move = task.pendingMove;
    if (!move || move.fromExternalId === null || move.fromSource === 'local' || isDisconnected(move.fromSource)) return null;
    return { ...task, source: move.fromSource, externalId: move.fromExternalId };
  };

  /**
   * Commits a pending delete after its undo window (#99). Offline or on a network error the delete
   * stays queued for the next reconnect or start; any other failure restores the task locally and
   * reports through useErrorHandler.
   */
  const commitTaskDelete = async (taskId: string): Promise<DeleteCommitResult> => {
    const pending = mapHelpers.get(tasksStore.pendingDeletes, taskId);
    if (!pending || deletesInFlight.has(taskId)) return 'skipped';

    const hasUpstream = pending.task.source !== 'local' || originToRemove(pending.task) !== null;
    if (hasUpstream && typeof navigator !== 'undefined' && navigator.onLine === false) {
      tasksStore.markPendingDeleteQueued(taskId);
      return 'queued';
    }
    // A 429 limits the whole source (#543): the delete waits behind the pause like an offline one, without a request
    if (sourcesOfDelete(pending.task).some((source) => isRateLimited(source))) {
      tasksStore.markPendingDeleteQueued(taskId);
      return 'queued';
    }

    deletesInFlight.add(taskId);
    try {
      let current = pending;
      for (let pass = 0; pass < 2; pass++) {
        await deleteTaskUpstream(current);
        // A fetch that ran meanwhile may have handed the page of a create in doubt to this delete (#538): that page goes too
        const live = mapHelpers.get(tasksStore.pendingDeletes, taskId);
        if (!live || (live.task.externalId === current.task.externalId && live.task.pendingMove?.fromExternalId === current.task.pendingMove?.fromExternalId)) break;
        current = live;
      }
    } catch (error) {
      if (!isAlreadyGone(error)) {
        if (isDeleteNetworkFailure(error) || rateLimitOf(error) !== null || isDoubtNotSettled(error)) {
          tasksStore.markPendingDeleteQueued(taskId);
          return 'queued';
        }
        // A fetch may have handed the page of a create in doubt to the delete meanwhile (#538): the task comes back on
        // the live delete, with that page and without the doubt, and the page leaves `deletedTaskIds` (#535 review)
        const live = mapHelpers.get(tasksStore.pendingDeletes, taskId) ?? pending;
        tasksStore.removePendingDelete(taskId);
        tasksStore.undeleteTask(taskId, live.task.externalId, live.task.pendingMove?.fromExternalId);
        if (!tasksStore.task(taskId)) tasksStore.addTask(live.task);
        tasksStore.restoreCarryOver(taskId, live.carryOver);
        // The task is back on the board for good: whoever called (the delete window, a flush) leaves no trash entry (#543)
        useTrashStore().remove(taskId);
        statisticsStore.removeDiscardedTime(taskId);
        handleError(error instanceof Error ? error : String(error), 'task_delete');
        return 'restored';
      }
    } finally {
      deletesInFlight.delete(taskId);
    }

    tasksStore.removePendingDelete(taskId);
    return 'committed';
  };

  /**
   * Brings a trashed task back (#422, D5). Rejects on failure and then changes nothing: no half-restored task on
   * the board, the entry stays in the trash (the caller reports it).
   * - the delete has not reached the source yet (queued offline): the delete is cancelled, nothing is called;
   * - otherwise the source restores first (`adapter.restore`: Local re-adds, Notion un-archives the page or
   *   creates a new one, Todoist creates a new task), a source that is not connected or offline rejects;
   * - then, in one synchronous step: `undeleteTask`, add to the board, the restore guard (a fetch that started
   *   before does not drop the task), carry-over, and the trash entry goes.
   * A task from Jetzt returns to Offen (WIP limit), every other task to its old column, at its end.
   */
  const restoreTask = async (entry: TrashEntry): Promise<void> => {
    const trashStore = useTrashStore();
    const taskId = entry.taskId;
    if (deletesInFlight.has(taskId)) throw new Error('The delete is still being sent to the source, try again in a moment');

    const status = entry.fromStatus === TaskStatus.Progress ? TaskStatus.Open : entry.fromStatus;
    // A Jetzt snapshot returns to Offen: a stale not-planned marker must not hide it there (#354)
    const base: Task = { ...inStatus(entry.task, status), timerId: null };
    const queued = mapHelpers.get(tasksStore.pendingDeletes, taskId);

    let restored: Task;
    // Removals of the source's pages wait while its restore is in flight, until the page sits on the board (#578)
    let endWrite: () => void = () => {};
    if (queued) {
      // The source still holds the task: cancelling the queued delete is the whole upstream part. A fetch may have
      // handed the page of a create in doubt to the delete meanwhile (#538): the task takes that page back with it.
      const { pendingSync: _held, pendingMove: _move, ...bare } = base;
      restored = {
        ...bare,
        externalId: queued.task.externalId,
        ...(queued.task.pendingSync ? { pendingSync: queued.task.pendingSync } : {}),
        ...(queued.task.pendingMove ? { pendingMove: queued.task.pendingMove } : {}),
      };
    } else if (base.source === 'local') {
      restored = await adapterFor('local').restore(base);
    } else {
      if (!sourceCan(base.source, 'remove')) throw new SourceReadOnlyError(base.source, 'restoring a task');
      if (isDisconnected(base.source)) throw new Error(`${base.source} is not connected`);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Network error: you are offline');
      const { pendingSync: _sync, pendingMove: _move, ...clean } = base;
      // An earlier restore's create may have made the page (#535): the adapter looks for it before it creates
      const attemptedAt = Date.now();
      // While the create runs a fetch must not hand the page to this entry: the create finds or makes it itself (#545)
      const ownsGuard = !restoresInFlight.has(taskId);
      restoresInFlight.add(taskId);
      endWrite = beginSourceWrite(base.source);
      try {
        restored = await adapterFor(base.source).restore(clean, {
          claimedExternalIds: tasksStore.claimedPages(base.source),
          ...(trashStore.entry(taskId)?.createUncertain ? { createUncertain: trashStore.entry(taskId)!.createUncertain } : {}),
        });
      } catch (error) {
        endWrite();
        // The entry stays in the trash; a create that may have landed is remembered on it (the same rule as a push)
        if (createOutcomeUnknown(error)) trashStore.markCreateUncertain(taskId, attemptedAt, base.title || 'Untitled');
        throw error;
      } finally {
        if (ownsGuard) restoresInFlight.delete(taskId);
      }
    }

    // One synchronous step from here: nothing may interleave between the guard release and the board
    try {
      tasksStore.removePendingDelete(taskId);
      tasksStore.undeleteTask(taskId, restored.externalId, entry.task.externalId);
      // A fetch that landed while the restore's create was in flight made a card of the page (#555): the entry's task stays
      dropLandedCards(restored.source, restored.externalId, taskId);
      if (!tasksStore.task(taskId)) tasksStore.addTask({ ...restored, id: taskId, status, timerId: null });
    } finally {
      endWrite();
    }
    tasksStore.guardRestoredTask(taskId);
    const back = tasksStore.task(taskId);
    if (back && isNotPlanned(back)) {
      // A task that was not planned returns to "Alle Aufgaben", on top: it has no place in Offen's order (#354)
      boardStore.noteNotPlanned(taskId);
    } else {
      // The column's order still names the task where it stood: take it out there, then it goes to the end
      boardStore.updateTaskPosition(taskId, status, entry.fromStatus);
    }
    tasksStore.restoreCarryOver(taskId, entry.carryOver);
    trashStore.remove(taskId);
    // The time lives on the task again (#537)
    statisticsStore.removeDiscardedTime(taskId);
    // A cancelled queued delete leaves the source with the Jetzt status it held: tell it (a no-op write for Local)
    if (queued && status !== entry.task.status && restored.source !== 'local') {
      void updateTaskStatus({ taskId, status, skipLocalUpdate: true });
    }
  };

  /**
   * Commits a move after its undo window (#322, phase 2): creates the task in its target source with its
   * current state, then removes the origin copy. The order is the safety net: the origin is only touched after
   * the target holds the task. The task keeps its `id` throughout.
   * - target Local: no create, only the origin copy is removed;
   * - target offline or needing attention, or a transient failure (no connection, 401, 403, 429, 5xx): the move
   *   stays local with its marker and failure reason, the next flush continues it ('queued', no toast);
   * - create rejected for good (400, 409, any other 4xx): the task goes back to its origin and nothing is
   *   deleted ('reverted'), `lib/taskMoveEvents` tells the toast;
   * - the origin copy cannot be removed after a successful create: the task lives in its target and
   *   `pendingMove` stays with the new `externalId`, the next flush retries the removal ('queued');
   * - the task is deleted meanwhile: the page that was just created is removed again.
   */
  const commitTaskMove = async (taskId: string): Promise<MoveCommitResult> => {
    const task = tasksStore.task(taskId);
    if (!task?.pendingMove || tasksStore.isMoveHeld(taskId) || movesInFlight.has(taskId)) return 'skipped';
    movesInFlight.add(taskId);
    try {
      if (task.source !== 'local' && task.externalId === null) {
        const created = await createMovedTask(task);
        if (created !== 'created') return created;
      }
      return await removeMoveOrigin(taskId);
    } finally {
      movesInFlight.delete(taskId);
    }
  };

  /** Step one of a move: the target creates the task. 'created' when its page exists and `externalId` is stored. */
  const createMovedTask = async (task: Task): Promise<'created' | MoveCommitResult> => {
    const target = task.source;
    const move = task.pendingMove!;
    const reason = health.needsAttention(target) ? health.healthOf(target).lastError ?? 'Source needs attention'
      : typeof navigator !== 'undefined' && navigator.onLine === false ? 'Offline'
      : isRateLimited(target) ? 'Rate limited'
      : null;
    if (reason !== null) {
      // Nothing is called: the move waits behind the marker. The reason shows on the card, once.
      if (tasksStore.task(task.id)?.pendingSync?.lastError == null) tasksStore.recordPendingSyncFailure(task.id, reason);
      return 'queued';
    }

    const revision = tasksStore.markPendingSync(task.id);
    const adapter = adapterFor(target);
    let created: Task;
    let externalId: string;
    let live: Task | null;
    const createAttemptedAt = Date.now();
    const endWrite = beginSourceWrite(target);
    try {
      try {
        created = await adapter.create(task, { claimedExternalIds: tasksStore.claimedPages(target) });
      } catch (error) {
        if (isCreateWaiting(error)) return 'queued';
        if (createOutcomeUnknown(error)) tasksStore.markCreateUncertain(task.id, createAttemptedAt, task.title || 'Untitled');
        if (createFailureKind(error) === 'transient') {
          deferMove(task, error);
          return 'queued';
        }
        tasksStore.restoreMoveOrigin(task.id);
        notifyTaskMoveRejected({ taskId: task.id, title: task.title, fromSource: move.fromSource, toSource: target, error });
        return 'reverted';
      }
      externalId = created.externalId ?? created.id;
      live = tasksStore.task(task.id);
      if (live) forgetDroppedCards(tasksStore.completeMoveCreate(task.id, externalId));
    } finally {
      endWrite();
    }

    if (!live) {
      // Deleted while the create was in flight: the page it made must not stay behind
      await adapter.remove({ ...task, externalId }).catch((error) => console.error('[TaskSync] Could not remove the page of a deleted moving task:', error));
      return 'skipped';
    }
    restoreSourceAfterPush(target);

    // The create writes the title, status, priority, timebox, topic, activity, notes and custom values; time spent
    // and the completion date need a write of their own. A failure keeps the marker: the next flush sends it.
    const settled = tasksStore.task(task.id)!;
    if (settled.timeSpentSeconds > 0 || settled.completedAt) {
      try {
        await adapter.update(settled);
        tasksStore.clearPendingSync(task.id, revision);
      } catch (error) {
        tasksStore.recordPendingSyncFailure(task.id, error instanceof Error ? error.message : String(error));
        console.error('[TaskSync] Follow-up write of a moved task failed:', error);
      }
    } else {
      tasksStore.clearPendingSync(task.id, revision);
    }
    return 'created';
  };

  /** A create failed for a reason that may pass: the move stays local, the reason goes on the marker, no toast. */
  const deferMove = (task: Task, error: unknown): void => {
    noteRateLimit(task.source, error);
    tasksStore.recordPendingSyncFailure(task.id, error instanceof Error ? error.message : String(error));
    if (isIntegrationSourceId(task.source) && !isDisconnected(task.source) && pushFailureScope(error) === 'source') {
      health.recordFailure(task.source, error);
    }
    console.error(`[TaskSync] Move of task ${task.id} to ${task.source} is queued:`, error);
  };

  /** Step two of a move: the origin copy goes (Notion: archive, Todoist: delete, Local: nothing upstream). */
  const removeMoveOrigin = async (taskId: string): Promise<MoveCommitResult> => {
    const task = tasksStore.task(taskId);
    if (!task?.pendingMove) return 'skipped';
    const origin = originToRemove(task);
    if (origin) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'queued';
      if (isRateLimited(origin.source)) return 'queued';
      const verdict = removalVerdict(origin);
      // A write of the origin source may be about to store this page on a task (#578): the removal waits
      if (verdict === 'hold') return 'queued';
      if (verdict === 'skip') tasksStore.forgetDeletedPage(origin.externalId!);
      else {
        try {
          await adapterFor(origin.source).remove(origin);
        } catch (error) {
          if (!isAlreadyGone(error)) {
            noteRateLimit(origin.source, error);
            console.error(`[TaskSync] Could not remove the origin copy of task ${taskId} yet:`, error);
            return 'queued';
          }
        }
      }
    }
    // The origin page of a create that may have landed has no id to remove (#538): look it up and archive it
    const doubt = task.pendingMove.fromCreateUncertain;
    if (!origin && doubt && task.pendingMove.fromExternalId === null && task.pendingMove.fromSource !== 'local' && !isDisconnected(task.pendingMove.fromSource)) {
      const fromSource = task.pendingMove.fromSource;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'queued';
      if (isRateLimited(fromSource)) return 'queued';
      try {
        await settleCreateDoubt(fromSource, doubt, taskId);
      } catch (error) {
        if (!isCreateWaiting(error)) {
          noteRateLimit(fromSource, error);
          console.error(`[TaskSync] Could not settle the origin create of task ${taskId} yet:`, error);
        }
        return 'queued';
      }
      // A fetch that ran meanwhile handed the origin page to the move: it is archived like any origin page
      const handedOver = tasksStore.task(taskId)?.pendingMove;
      if (handedOver && handedOver.fromExternalId !== null) return removeMoveOrigin(taskId);
    }
    tasksStore.clearPendingMove(taskId);
    return 'committed';
  };

  /**
   * Continues every move that is not inside an undo window: moves left over from a closed app, creates that
   * waited for a recovered source and origin removals that failed. Called on start, on reconnect and by every flush
   * of `syncPendingChanges` (`only` limits it to moves into or out of one source).
   */
  const commitPendingMoves = async (only?: SourceId): Promise<void> => {
    for (const task of [...tasksStore.tasks]) {
      const move = task.pendingMove;
      if (!move || tasksStore.isMoveHeld(task.id) || movesInFlight.has(task.id)) continue;
      if (only && task.source !== only && move.fromSource !== only) continue;
      await commitTaskMove(task.id);
    }
  };

  /** Notes what a source that plans by date holds the task as by its date now (`TaskSourceAdapter.planningHeld`, #553). */
  const noteHeldByDate = (taskId: string): void => {
    const live = tasksStore.task(taskId);
    if (!live) return;
    const adapter = adapterFor(live.source);
    // Only a source that plans by date notes a held value from the date; another source's value is the one it wrote
    if (adapter.planningByDate !== true || !adapter.planningHeld) return;
    tasksStore.setSourceNotPlanned(taskId, adapter.planningHeld(live) ?? undefined);
  };

  /**
   * Writes the user's plan or put-back to the sources that store planning (#357): a task of a source whose
   * adapter answers `notPlannedHold()` (Notion with a "not planned" status mapped) gets the status it is now held
   * as noted (`sourceNotPlanned`) and is pushed like any edit. Every task is marked pending at once, so a fetch
   * that lands before its write keeps the local state; the writes then run one after another (rate limits). A
   * task whose source already holds it that way and a task of a source without planning (Local, Todoist) get no
   * write.
   *
   * A source that plans by date (#553, `planningByDate`, Apple Reminders) writes on a plan only, and only when
   * `planWrite` answers a day (today: the date is not today, the reminder does not recur): the task is marked `dateWrite`
   * with that day and pushed, one after another. A put-back writes nothing and takes back a write that did not go out yet
   * (one already started cannot be stopped: `usePlanToasts.afterPutBack` waits for it). `whenPlanWritten` resolves when the
   * writes of a plan are done.
   */
  const writePlanning = (taskIds: readonly string[], back: boolean): void => {
    const toPush: string[] = [];
    for (const taskId of taskIds) {
      const task = tasksStore.task(taskId);
      if (!task || task.source === 'local') continue;
      const adapter = adapterFor(task.source);
      // A waiting task's plan and put-back stay kan-do's (#793, #374 4A and 5A): its source keeps the waiting status
      // (or knows none), so nothing is written; only an Open task's planning reaches a source. A source that plans by date
      // still notes what the date says now (local, no write) and a put-back takes back a date write not yet sent, as for an
      // Open task: the next fetch then compares with the answer the user's choice was made under
      if (task.status !== TaskStatus.Open) {
        if (adapter.planningByDate === true && canBeOffToday(task.status)) {
          if (back) tasksStore.dropDateWrite(taskId);
          noteHeldByDate(taskId);
        }
        continue;
      }
      if (adapter.planningByDate === true) {
        if (back) tasksStore.dropDateWrite(taskId);
        // The plan the source cannot hold stays kan-do's: what the source delivers for the date is noted as it is now, so the
        // next fetch sees "the same answer as last time" and leaves the user's choice alone (a put-back while the source says
        // today, a series planned on another day)
        noteHeldByDate(taskId);
        const day = back ? null : (adapter.planWrite?.(task) ?? null);
        if (day !== null) {
          tasksStore.markDateWrite(taskId, day);
          toPush.push(taskId);
        }
        continue;
      }
      const hold = adapter.notPlannedHold?.() ?? null;
      if (hold === null) continue;
      // A put-back keeps the "not planned" status the source already holds the task in (its second or third one)
      const changed = back
        ? task.sourceNotPlanned === undefined && tasksStore.setSourceNotPlanned(taskId, hold)
        : tasksStore.setSourceNotPlanned(taskId, undefined);
      if (!changed) continue;
      tasksStore.markPendingSync(taskId);
      toPush.push(taskId);
    }
    if (toPush.length === 0) return;
    const writes = (async () => {
      for (const taskId of toPush) {
        const live = tasksStore.task(taskId);
        // Inside a 429 window the rest stays marked; `syncPendingChanges` sends it after the window (#529)
        if (live && isRateLimited(live.source)) continue;
        if (live && live.pendingSync) await runSync(live);
        // The date was written: the source holds the task as planned now
        noteHeldByDate(taskId);
      }
    })();
    for (const taskId of toPush) planWritesInFlight.set(taskId, writes);
    void writes.finally(() => {
      for (const taskId of toPush) if (planWritesInFlight.get(taskId) === writes) planWritesInFlight.delete(taskId);
    });
  };

  /** Resolves when the writes the task's plan started have finished (at once when there are none). Never rejects. */
  const whenPlanWritten = (taskId: string): Promise<void> => (planWritesInFlight.get(taskId) ?? Promise.resolve()).catch(() => undefined);

  /**
   * Gives back the date the user's plan wrote (#553, the plan toast's "Rückgängig" and the put-back toast's "Altes Datum
   * zurück"): the adapter's compare-and-set, never blind. A task whose date was never written, or already restored, is a
   * no-op success. When Reminders moved on or the write fails, the error is reported (context `reminders_write`) and the
   * task keeps its state. The write waits for a push of the task that is under way and is noted like one, so a fetch that
   * lands meanwhile cannot undo it.
   * @returns whether the date is as asked for now (restored, or nothing to restore)
   */
  const restorePlannedDate = async (taskId: string): Promise<boolean> => {
    const first = tasksStore.task(taskId);
    if (!first || first.source === 'local') return true;
    const adapter = adapterFor(first.source);
    if (!adapter.restoreDueDate) return true;
    await pushesInFlight.get(taskId)?.catch(() => undefined);
    const task = tasksStore.task(taskId);
    if (!task) return true;
    // A task with unpushed changes (a failed done tick) already has a marker that shields it from a fetch and keeps it
    // queued: it stays exactly as it is. Only a marker this restore makes is this restore's to clear.
    const ownMarker = task.pendingSync === undefined;
    const revision = ownMarker ? tasksStore.markPendingSync(taskId) : undefined;
    try {
      const restored = await adapter.restoreDueDate(task);
      if (restored) applySyncedTask(taskId, restored);
      return true;
    } catch (error) {
      handleError(error instanceof Error ? error.message : String(error), 'reminders_write');
      if (import.meta.dev) console.error('[TaskSync] Restoring the old date failed:', error);
      return false;
    } finally {
      if (ownMarker) tasksStore.clearPendingSync(taskId, revision);
    }
  };

  /**
   * Plans a task for today (#353): it leaves "not planned" and lands at the end of Offen. The planned state is
   * kan-do's own; a source that stores planning (#357) gets the task's "today" status written (`writePlanning`),
   * for every other source no adapter is called and no `pendingSync` is set. Returns whether anything changed.
   */
  const planTask = (taskId: string): boolean => planTasks([taskId]).length > 0;

  /**
   * "Don't plan for today" (#353): takes an Offen task off today's board; it stays held with everything it has (time
   * spent, notes, topic, priority, timebox, its connection, the carried-over count). Refused (`false`) for a task
   * in any other column. A source that stores planning gets its "not planned" status written, as in `planTask`.
   */
  const unplanTask = (taskId: string): boolean => unplanTasks([taskId]).length > 0;

  /**
   * Several tasks at once (#356, #387): the fresh start the user triggers (`useNewDay().freshStart`). Same rules as
   * the single move, one board update; returns the ids that changed. Every caller is the user's own move, so a
   * source that stores planning is always written (#387: the app moves no card by itself, the option that kept a
   * move local went with the automatic pass).
   */
  const planTasks = (taskIds: readonly string[]): string[] => {
    const planned = tasksStore.planTasks(taskIds);
    writePlanning(planned, false);
    return planned;
  };
  const unplanTasks = (taskIds: readonly string[]): string[] => {
    const taken = tasksStore.unplanTasks(taskIds);
    writePlanning(taken, true);
    return taken;
  };

  /**
   * Standardized error handling for sync operations
   */
  const handleSyncError = (error: unknown, syncContext: string, source?: SourceId): void => {
    // The error itself, not only its text: the handler reads its status to tell an unreachable source (#851)
    const reported = error instanceof Error ? error : String(error);
    if (source && source !== 'local') handleError(reported, 'task_sync', { source });
    else handleError(reported, 'task_sync');
    // Still log to console for debugging
    console.error(`[TaskSync] ${syncContext}:`, error);
  };

  return {
    createTask,
    editTask,
    planTask,
    unplanTask,
    planTasks,
    unplanTasks,
    whenPlanWritten,
    restorePlannedDate,
    updateTaskStatus,
    updateTaskStatuses,
    setCompletedDay,
    syncTaskToIntegration,
    syncPendingChanges,
    isPushing,
    syncArchiveStatusForTasks,
    handleSyncError,
    deleteTaskUpstream,
    commitTaskDelete,
    restoreTask,
    commitTaskMove,
    commitPendingMoves,
  } as const;
};
