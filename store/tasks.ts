import { defineStore, acceptHMRUpdate  } from "pinia";
import { ref, computed, type Ref } from "vue";
import type { PendingSync, Task } from "@/types/task";
import { TaskStatus } from "~/types/taskStatus";
import { useBoardStore } from "./board";
import { useToday } from "~/composables/useToday";
import { usePropertyOptionsStore } from "./propertyOptions";
import type { PendingTimeUpdate } from "@/types/pendingTimeUpdate";
import { createPendingTimeUpdate, shouldCleanupPendingUpdate } from "@/types/pendingTimeUpdate";
import type { CustomPropertyIndex } from "~/types/customPropertyIndex";
import { extractValueKey, createCustomPropertyIndex } from "~/types/customPropertyIndex";
import type { SortField, SortDirection } from "~/types/state";
import { mapHelpers, setHelpers } from "~/utils/mapHelpers";
import type { CarryOverEntry } from "~/utils/carryOver";
import { advanceCarryOverEntry, createCarryOverEntry, localDateKey } from "~/utils/carryOver";
import { isNotPlanned, markerSurvives } from "~/lib/taskPlanning";
import { isValidDayKey } from "~/utils/recapDay";
import { isKnownSource } from "~/utils/sourceMeta";
import type { IntegrationSourceId, SourceId } from "~/types/taskSource";
import { disarmTaskTimer } from "~/lib/taskTimers";
import { discardLiveSeconds, liveSecondsOf } from "~/lib/liveTime";
import { generateTaskId, legacyTaskSource, normalizePendingDeletes, normalizeTasks, sourceSyncsTime } from "~/lib/taskSources";
import { normalizePriority } from "~/lib/priority";
import { renameField, type NameKind } from "~/lib/topicNames";
import { reviveDate, revivePendingDeletes, revivePendingTimeUpdates, reviveTaskDates } from "~/lib/taskDates";

/** How long a restored task survives a fetch that does not contain it (#422, D5). */
export const RESTORE_GUARD_MS = 60_000;

/**
 * A delete waiting for its upstream commit (#99). `waiting`: inside the undo window;
 * `queued`: the window has passed but the upstream call has not succeeded yet (offline, app closed).
 */
export interface PendingTaskDelete {
  taskId: string;
  /** Snapshot for undo and for restoring after a failed upstream delete; its `source` decides which integration receives the delete. */
  task: Task;
  carryOver: CarryOverEntry | null;
  state: 'waiting' | 'queued';
  requestedAt: number;
  /**
   * The column the task was in (#422). The trash entry made when the window closes and the gap that holds
   * the card's place both need it after the snapshot's status may have been rewritten. Absent on a delete
   * persisted before the trash: its status is read from the snapshot.
   */
  fromStatus?: TaskStatus;
  /**
   * Where the card's gap sits (#422): `afterId` is the card or gap that precedes it in the column as it was
   * displayed (`null` = first; an id that is no longer in the column falls back to the column end),
   * `height` the card's measured height in px (`null` when it could not be measured). Absent on a delete
   * persisted before the trash: no gap is rendered then. `afterId` undefined = the column end (the card
   * was on the board's DOM neither as a card nor as a member of a collapsed stack). A member of a collapsed
   * stack anchors at a member that stays and takes the stack's height (#433).
   */
  slot?: { afterId?: string | null; height: number | null };
  /** The task's index in its column's manual order at delete time: an undo puts it back there (#422). */
  orderIndex?: number | null;
}

export interface IUpdateStatusPayload {
  taskId: string;
  status: TaskStatus;
}

export interface IUpdateTimeSpentPayload {
  taskId: string;
  timeSpentSeconds: number;
}

/**
 * Helper function for sorting tasks by their order in columns.
 * Uses a Map for O(1) lookups instead of O(n) findIndex per comparison.
 */
const sortByTaskIdOrder = (
  taskIdOrder: Array<string>,
  tasks: Task[],
): Task[] => {
  // Build index map once: O(n)
  const orderMap = new Map(taskIdOrder.map((id, i) => [id, i]));
  
  // Sort using O(1) lookups: O(n log n) total instead of O(n² log n)
  return [...tasks].sort((a, b) => {
    const aIndex = orderMap.get(a.id) ?? Infinity;
    const bIndex = orderMap.get(b.id) ?? Infinity;
    return aIndex - bIndex;
  });
};

/**
 * Helper to safely get timestamp from Date or string
 */
const getTimestamp = (date: Date | string | null | undefined): number => {
  if (!date) return 0;
  if (date instanceof Date) return date.getTime();
  const d = new Date(date);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

/**
 * The earlier of the local and the fetched creation time (#322): Notion and Todoist stamp their own time on a
 * page created for a moved task, which must not reset the date the task was made. A missing or invalid date loses.
 */
const earlierCreatedAt = (local: Date | string | null | undefined, fetched: Date | string | null | undefined): Task['createdAt'] => {
  const localTime = getTimestamp(local);
  const fetchedTime = getTimestamp(fetched);
  if (localTime === 0) return (fetched ?? null) as Task['createdAt'];
  if (fetchedTime === 0 || localTime <= fetchedTime) return local as Task['createdAt'];
  return fetched as Task['createdAt'];
};

/**
 * Helper to sort tasks based on column configuration
 */
const sortTasks = (
  tasks: Task[],
  sorting: { field: SortField; direction: SortDirection } | undefined,
  manualOrder: string[]
): Task[] => {
  // Default to manual sorting if not specified or explicitly manual
  if (!sorting || sorting.field === 'manual') {
    return sortByTaskIdOrder(manualOrder, tasks);
  }

  return [...tasks].sort((a, b) => {
    let valA: number | string;
    let valB: number | string;

    switch (sorting.field) {
      case 'dateCreated':
        valA = getTimestamp(a.createdAt);
        valB = getTimestamp(b.createdAt);
        break;
      case 'dateCompleted':
        valA = getTimestamp(a.completedAt);
        valB = getTimestamp(b.completedAt);
        break;
      case 'dateUpdated':
        valA = getTimestamp(a.updatedAt);
        valB = getTimestamp(b.updatedAt);
        break;
      case 'priority':
        valA = normalizePriority(a.priority);
        valB = normalizePriority(b.priority);
        break;
      case 'timeBox':
        valA = a.timeBoxSeconds ?? 0;
        valB = b.timeBoxSeconds ?? 0;
        break;
      default:
        return 0;
    }

    if (valA === valB) {
        return 0;
    }

    const comparison = valA < valB ? -1 : 1;
    return sorting.direction === 'asc' ? comparison : -comparison;
  });
};

/** Seconds a Jetzt timer counted after the local midnight (the start of `day`) it ran across, while the user was away from the window (#356). */
export interface AfterMidnightCount {
  taskId: string
  /** Local day (`YYYY-MM-DD`) that midnight starts */
  day: string
  seconds: number
  /**
   * The wall-clock spans (`[from, to]`, epoch ms, never before that midnight) in which those seconds were counted:
   * the same stretch is taken out of the Statistik work sessions when the seconds are removed (D3 h).
   */
  spans: Array<[number, number]>
}

/** Most spans one note keeps (a count that long needs one absence per span); beyond it the nearest two merge. */
const AFTER_MIDNIGHT_MAX_SPANS = 50

/** Local midnight (epoch ms) that starts the day `YYYY-MM-DD`. */
const startOfDayMs = (day: string): number => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date!).getTime()
}

/** Spans as trusted values: usable entries only, sorted, overlapping or touching ones merged, capped. */
function normalizeSpans(raw: unknown, notBefore: number): Array<[number, number]> {
  if (!Array.isArray(raw)) return []
  const spans: Array<[number, number]> = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [from, to] = entry as [unknown, unknown]
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) continue
    const start = Math.max(from, notBefore)
    if (to > start) spans.push([start, to])
  }
  spans.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([span[0], span[1]])
  }
  while (merged.length > AFTER_MIDNIGHT_MAX_SPANS) {
    let at = 0
    for (let index = 1; index < merged.length - 1; index++) {
      if (merged[index + 1]![0] - merged[index]![1] < merged[at + 1]![0] - merged[at]![1]) at = index
    }
    merged.splice(at, 2, [merged[at]![0], merged[at + 1]![1]])
  }
  return merged
}

/** A stored `afterMidnight` as a trusted value: anything malformed reads as null (nothing is ever taken off for it). */
export function sanitizeAfterMidnight(raw: unknown): AfterMidnightCount | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { taskId, day, seconds } = raw as { taskId?: unknown; day?: unknown; seconds?: unknown };
  if (typeof taskId !== 'string' || !isValidDayKey(day) || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return { taskId, day, seconds, spans: normalizeSpans((raw as { spans?: unknown }).spans, startOfDayMs(day)) };
}

/**
 * Factory function to create task getters by status
 */
const createTasksByStatusGetter = (status: TaskStatus, tasks: Ref<Task[]>) => computed(() => {
  const boardStore = useBoardStore();
  const column = boardStore.columnByTaskStatus(status);
  const order = column?.taskOrder ?? [];
  const sorting = column?.sorting;
  
  // A task that is not planned for today (#353) is in no column; only an Open task can be one
  const filtered = tasks.value.filter((task: Task) => task.status === status && !isNotPlanned(task));
  return sortTasks(filtered, sorting, order);
});

export const useTasksStore = defineStore("tasks", () => {
  // State
  const tasks = ref<Array<Task>>([]);
  const isLoading = ref(false);
  const lastSyncTimestamp = ref<Date | null>(null);
  const pendingTimeUpdates = ref<Record<string, PendingTimeUpdate>>({}); // Record instead of Map
  const archivedTaskIds = ref<string[]>([]); // Local-only archive state (UI filter)
  const deletedTaskIds = ref<string[]>([]); // Track deleted task IDs to prevent resurrection on sync
  const customPropertyIndexes = ref<Record<string, CustomPropertyIndex>>({}); // Record instead of Map
  const taskOperationVersions = ref<Record<string, number>>({}); // Track operation versions per task
  const batchOperationInProgress = ref(false); // Flag to prevent updates during batch operations
  /** Carried-over counter per task id (#99). Missing key hydrates to {}; pruned in mergeTasks. */
  const carryOverByTaskId = ref<Record<string, CarryOverEntry>>({});
  /** Deletes whose upstream call has not been committed yet (#99), keyed by task id. */
  const pendingDeletes = ref<Record<string, PendingTaskDelete>>({});
  /**
   * The seconds a Jetzt timer counted after the local midnight it ran across (#356), persisted so a reload keeps
   * it: one entry, for the one task whose timer crossed the last midnight. Written by the timer driver
   * (`beginAfterMidnight` at the crossing, then every checkpoint through `addTrackedSeconds`), read once by the new
   * day's check (`useNewDay().check`: `takeAfterMidnight`, which it turns into the question of the day-recap store). Additive: older data has none (null); read it through
   * `validAfterMidnight`.
   */
  const afterMidnight = ref<AfterMidnightCount | null>(null);
  const validAfterMidnight = computed(() => sanitizeAfterMidnight(afterMidnight.value));
  /**
   * Transient (never persisted): the local day whose check already took the note (`settleAfterMidnight`). A tick that
   * sees that day's midnight only after its check (the machine slept across midnight and the wake-up's focus event
   * came before the timer's first tick, or the crossing write was held) starts no note: what the timer counts after
   * the check is the user's own running timer, never asked about (#387 D1 g). Runtime is enough: a page load arms
   * every timer on the current day, so it never sees a crossing into that day.
   */
  let afterMidnightSettledDay: string | null = null;
  /**
   * Transient (never persisted, per Pinia instance) status locks: while a locally-initiated
   * status change (e.g. undoing a completion) is still being written upstream, a concurrent
   * refresh must not overwrite it with stale upstream data. One entry per task, owned by a token:
   * the newest lock wins, and only its owner can release it (an older write finishing later must not
   * drop a newer write's lock).
   */
  const statusLocks = new Map<string, { token: number; status: TaskStatus; completedAt: Date | null }>();
  /**
   * Transient (never persisted) guard of a task restored from the trash (#422, D5): task id -> when. A fetch
   * that started before the restore finished does not contain the task; `mergeTasks` keeps a guarded local
   * task instead of dropping it, and releases the guard once a merge contains it or after `RESTORE_GUARD_MS`.
   */
  const restoreGuard = new Map<string, number>();
  /**
   * Transient (never persisted): when a write of each task was last noted or ended (task id -> epoch ms): a change
   * that needs a push, a push that went through, a push that failed (it may have reached the source all the same).
   * A fetch that began before that may lack a task its source holds (#357): Notion's board query is read before
   * its "not planned" query, so a plan written between the two reads is in neither answer, and a page past the
   * cap is in none before the plan took it out of there. `mergeTasks` keeps such a task (`fetchStartedAt`).
   */
  const writtenAt = new Map<string, number>();
  /**
   * Transient (never persisted): per source, the ids of the tasks the last merge's list lacked and the merge kept
   * all the same (#392). A list says that a task is gone only when it and the one before lack it: a page moved at
   * the source between the two reads of one sync is in neither query's answer, and a failing push stamps
   * `writtenAt` on every tick. Replaced by each merge of the source, forgotten at a reload.
   */
  const lackedByLastMerge = new Map<SourceId, Set<string>>();
  let nextStatusLockToken = 0;
  /**
   * Transient (never persisted) revision of each task's `pendingSync`, bumped by every change that needs a
   * push. A write remembers the revision it started with and clears the marker only if no newer change came
   * in meanwhile, so an edit made during a push is not marked as pushed.
   */
  const pendingSyncRevisions = new Map<string, number>();

  // Getters
  /**
   * Finds a task by ID. This is a function (not a computed returning a function)
   * to ensure proper reactivity tracking when called inside other computeds.
   */
  const task = (id: string): Task | null => {
    return tasks.value.find((el) => el.id === id) ?? null;
  };

  const tasksOpen = createTasksByStatusGetter(TaskStatus.Open, tasks);
  const tasksProgress = createTasksByStatusGetter(TaskStatus.Progress, tasks);
  const tasksWaiting = createTasksByStatusGetter(TaskStatus.Waiting, tasks);
  const tasksDone = createTasksByStatusGetter(TaskStatus.Done, tasks);
  /**
   * The tasks kan-do holds that are not planned for today (#353), in no column. Order (#354): the tasks put back
   * by hand first, newest first (`boardStore.notPlannedOrder`), then the rest in the order they are stored.
   */
  const tasksNotPlanned = computed(() => {
    const held = tasks.value.filter((task: Task) => isNotPlanned(task));
    const rank = new Map(useBoardStore().notPlannedOrder.map((id, index) => [id, index]));
    if (rank.size === 0) return held;
    // Array.prototype.sort is stable: unlisted tasks keep their stored order behind the listed ones
    return [...held].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || 0);
  });

  /** Reactive local start of today: a board left open overnight re-evaluates the day split */
  const { today: todayRef } = useToday();

  /**
   * Tasks marked done today (not archived)
   */
  const tasksDoneToday = computed(() => {
    const boardStore = useBoardStore();
    const column = boardStore.columnByTaskStatus(TaskStatus.Done);
    const order = column?.taskOrder ?? [];
    const sorting = column?.sorting;
    const today = todayRef.value;

    const filtered = tasks.value.filter((task: Task) => {
      if (task.status !== TaskStatus.Done) return false;
      if (archivedTaskIds.value.includes(task.id)) return false;
      
      // If task has completedAt, check if it's today
      if (task.completedAt) {
        return task.completedAt >= today;
      }
      
      // No completedAt: default to "today" for new completions
      return true;
    });
    return sortTasks(filtered, sorting, order);
  });

  /**
   * Tasks marked done before today (not archived)
   */
  const tasksDonePrevious = computed(() => {
    const boardStore = useBoardStore();
    const column = boardStore.columnByTaskStatus(TaskStatus.Done);
    const order = column?.taskOrder ?? [];
    const sorting = column?.sorting;
    const today = todayRef.value;

    const filtered = tasks.value.filter((task: Task) => {
        if (task.status !== TaskStatus.Done) return false;
        if (archivedTaskIds.value.includes(task.id)) return false;
        
        // If task has completedAt, check if it's before today
        if (task.completedAt) {
          return task.completedAt < today;
        }
        
        // No completedAt for done task: assume it's old (previous day)
        return false;
      });
    return sortTasks(filtered, sorting, order);
  });

  /**
   * Count of archivable tasks (done before today)
   */
  const archivableTaskCount = computed(() => {
    return tasksDonePrevious.value.length;
  });

  /**
   * Count of archived tasks
   */
  const archivedTaskCount = computed(() => {
    return archivedTaskIds.value.length;
  });

  const hasPendingTimeUpdates = computed(() => {
    return mapHelpers.size(pendingTimeUpdates.value) > 0;
  });

  /**
   * Whether the source does not hold the task's local state yet (#319): it carries the `pendingSync` marker,
   * or tracked time waits in the time queue. A timer tick queues time without the marker, so a running timer
   * does not freeze the rest of the task against a fetch (see `mergeTasks`).
   */
  const isSyncPending = (taskId: string): boolean =>
    tasks.value.find((el) => el.id === taskId)?.pendingSync !== undefined || mapHelpers.has(pendingTimeUpdates.value, taskId);

  /** Tasks whose local state the source does not hold yet, in board order. */
  const pendingSyncTasks = computed((): Task[] => tasks.value.filter((el) => el.source !== 'local' && isSyncPending(el.id)));
  const hasPendingSync = computed(() => pendingSyncTasks.value.length > 0);

  /**
   * Whether tasks of two or more sources sit on the board (#323): the cards then show their source icon.
   * Derived from the tasks, not from `boardConfig.sources`: a connected source without tasks yet shows nothing.
   * The add sheet's draft card is not in the store, so it never counts.
   */
  const hasMultipleSources = computed((): boolean => {
    const seen = new Set<string>();
    for (const el of tasks.value) {
      if (!isKnownSource(el.source)) continue;
      seen.add(el.source);
      if (seen.size >= 2) return true;
    }
    return false;
  });

  /**
   * Get pending updates that have failed and need attention
   */
  const failedPendingUpdates = computed((): PendingTimeUpdate[] => {
    return mapHelpers.values(pendingTimeUpdates.value)
      .filter(update => update.status === 'failed');
  });

  /**
   * Get count of pending updates by status
   */
  const pendingUpdateStats = computed(() => {
    const stats = { pending: 0, syncing: 0, failed: 0 };
    mapHelpers.forEach(pendingTimeUpdates.value, update => {
      stats[update.status]++;
    });
    return stats;
  });

  // Actions
  function updateTask(taskId: string, updates: Partial<Task>) {
    // Skip updates during batch operations to prevent re-grouping
    if (batchOperationInProgress.value) {
      return;
    }
    
    const task = tasks.value.find((el) => el.id === taskId);

    if (task) {
      const wasInDone = task.status === TaskStatus.Done;
      const statusBefore = task.status;
      Object.assign(task, updates);
      // "Not planned" (#353) exists only for a task that stays Open: any other status, before or after the
      // change, puts the task on the board (a marker an older app version left on a moved task never hides it).
      // What the source held it as (#357) ends with it: the write of this status tells the source the column
      if (!markerSurvives(statusBefore, task.status)) {
        if (task.notPlanned !== undefined) delete task.notPlanned;
        if (task.sourceNotPlanned !== undefined) delete task.sourceNotPlanned;
      }
      // A completion time written by anything but the user's correction (reopening, completing again, an undo)
      // is no longer the corrected one (kd#131)
      if ('completedAt' in updates && !('completedAtCorrected' in updates)) delete task.completedAtCorrected;
      // A change inside a move's undo window (starting or stopping the timer excepted) is not on the origin
      // copy: Undo has to push it there (#322)
      if (heldMoves.has(taskId) && Object.keys(updates).some((key) => key !== 'timerId')) heldChanged.add(taskId);
      
      // Update statistics if task is in Done status and not archived
      const isArchived = archivedTaskIds.value.includes(taskId);
      const isInDone = task.status === TaskStatus.Done;
      
      if (isInDone && wasInDone && !isArchived) {
        // Task properties changed while in Done status (e.g., time spent updated)
        // Update statistics record (use dynamic import to avoid circular dependency)
        import('~/store/taskStatistics').then(({ useTaskStatisticsStore }) => {
          const statisticsStore = useTaskStatisticsStore();
          statisticsStore.updateTaskRecord(task);
        }).catch((error) => {
          console.warn('Failed to update task statistics:', error);
        });
      }
    }
    else {
      console.error(`Task with id ${taskId} not found for update`);
    }
  }

  /**
   * Notes that the task has changes the source does not hold yet: sets its `pendingSync` marker (once, the
   * first change keeps `since`) and returns the revision a write must hand back to `clearPendingSync`.
   * A Local task has no upstream and never gets one (0). `upstreamDone` (whether the source holds the task as
   * completed) is taken by a new marker and by an older one that lacks it; an existing answer stays, as the
   * source has not changed since.
   */
  function markPendingSync(taskId: string, upstreamDone?: boolean): number {
    const target = tasks.value.find((el) => el.id === taskId);
    if (!target || target.source === 'local') return 0;
    const revision = (pendingSyncRevisions.get(taskId) ?? 0) + 1;
    pendingSyncRevisions.set(taskId, revision);
    const now = Date.now();
    writtenAt.set(taskId, now);
    if (!target.pendingSync) target.pendingSync = { since: now, attempts: 0, lastError: null };
    if (target.pendingSync.upstreamDone === undefined) {
      target.pendingSync.upstreamDone = upstreamDone ?? target.status === TaskStatus.Done;
    }
    return revision;
  }

  /** The revision a push of the task starts from (0 for a marker restored from storage, or none). */
  function pendingSyncRevision(taskId: string): number {
    return pendingSyncRevisions.get(taskId) ?? 0;
  }

  /**
   * A push of the task went through: drops the marker and the queued time update (the push carried the time
   * too). A `pendingMove` stays: the origin copy of a move is removed by `clearPendingMove`, not by a push. With the `revision` of the write it started, a change made since keeps the marker; it then records what the
   * push left the source holding (`upstreamDone`), so the next push does not reopen a task that is open.
   * @returns whether the marker was cleared
   */
  function clearPendingSync(taskId: string, revision?: number, upstreamDone?: boolean): boolean {
    if (revision !== undefined && pendingSyncRevision(taskId) !== revision) {
      const kept = tasks.value.find((el) => el.id === taskId);
      if (kept?.pendingSync && upstreamDone !== undefined) kept.pendingSync.upstreamDone = upstreamDone;
      if (kept) writtenAt.set(taskId, Date.now());
      return false;
    }
    const target = tasks.value.find((el) => el.id === taskId);
    if (target) {
      delete target.pendingSync;
      writtenAt.set(taskId, Date.now());
    }
    pendingSyncRevisions.delete(taskId);
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
    return true;
  }

  /**
   * A create of the task ended with an unknown outcome (#528: the page may exist): the marker says since when and
   * under which title, so the next create looks for the page first. The earliest time stays, the title is the last
   * one sent; a task that already has an `externalId` has none.
   */
  function markCreateUncertain(taskId: string, since: number, title: string): void {
    const target = tasks.value.find((el) => el.id === taskId);
    if (!target?.pendingSync || target.externalId !== null) return;
    const held = target.pendingSync.createUncertain;
    target.pendingSync = { ...target.pendingSync, createUncertain: { since: Math.min(since, held?.since ?? since), title } };
  }

  /** A push of the task failed: counts the attempt and keeps the reason on the marker. */
  function recordPendingSyncFailure(taskId: string, errorMessage: string): void {
    const target = tasks.value.find((el) => el.id === taskId);
    if (!target?.pendingSync) return;
    writtenAt.set(taskId, Date.now());
    target.pendingSync = { ...target.pendingSync, attempts: target.pendingSync.attempts + 1, lastError: errorMessage };
  }

  /**
   * The source created a task that was made while it was unreachable: the task keeps its `id` and takes the
   * `externalId` the source gave it, then counts as pushed (unless it changed again meanwhile).
   */
  function completeCreate(taskId: string, created: Pick<Task, 'externalId'>, revision?: number): void {
    const target = tasks.value.find((el) => el.id === taskId);
    if (target && target.source !== 'local') target.externalId = created.externalId ?? target.externalId;
    clearPendingSync(taskId, revision);
  }

  /**
   * Phase 1 of a move to another source (#322, ADR 015): the task takes `target` as its source, loses its
   * `externalId` (the target creates its own page) and records where it came from in `pendingMove`, all in one
   * mutation. `id`, column, position, timer, tracked time and dates stay (everything is keyed by `id`). A target
   * with an upstream also gets the `pendingSync` marker, so a restart sees a task whose create is outstanding.
   * Time queued for the origin goes (the origin is being left), and the operation version moves on so a response
   * of a write still in flight to the origin is dropped. Nothing goes upstream here.
   * @returns what `restoreMoveOrigin` needs to undo it; null when there is nothing to move (unknown task,
   *   already in `target`, or a move is already outstanding)
   */
  function reassignSource(taskId: string, target: SourceId): { pendingSync: PendingSync | undefined } | null {
    const moving = tasks.value.find((el) => el.id === taskId);
    if (!moving || moving.source === target || moving.pendingMove) return null;
    const previous = { pendingSync: moving.pendingSync };
    moving.pendingMove = {
      fromSource: moving.source,
      fromExternalId: moving.externalId,
      toSource: target,
      ...(moving.sourceNotPlanned !== undefined ? { fromSourceNotPlanned: moving.sourceNotPlanned } : {}),
    };
    moving.source = target;
    moving.externalId = null;
    // What the old source held the task as says nothing about the new one (#357); the marker itself stays, and
    // the move keeps the old value for its way back (`restoreMoveOrigin`)
    delete moving.sourceNotPlanned;
    delete moving.pendingSync;
    pendingSyncRevisions.delete(taskId);
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
    incrementTaskOperationVersion(taskId);
    markPendingSync(taskId); // no-op for Local: it has no upstream to wait for
    return previous;
  }

  /**
   * Puts a task back where `pendingMove` says it came from: the undo of a move (`previous` is what
   * `reassignSource` returned, so the task carries the marker it had before) and the answer to a rejected create
   * (no `previous`: an integration origin gets a fresh marker, because the task may have changed since). Nothing
   * is called upstream, so there is nothing to revert there. A task changed inside the undo window (`heldChanged`)
   * comes back to an integration origin with a marker, so the next flush sends it what it missed.
   */
  function restoreMoveOrigin(taskId: string, previous?: { pendingSync: PendingSync | undefined }): void {
    const moved = tasks.value.find((el) => el.id === taskId);
    const move = moved?.pendingMove;
    if (!moved || !move) return;
    moved.source = move.fromSource;
    moved.externalId = move.fromExternalId;
    if (move.fromSourceNotPlanned !== undefined) moved.sourceNotPlanned = move.fromSourceNotPlanned;
    else delete moved.sourceNotPlanned;
    delete moved.pendingMove;
    delete moved.pendingSync;
    pendingSyncRevisions.delete(taskId);
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
    incrementTaskOperationVersion(taskId);
    const changedInWindow = heldChanged.delete(taskId);
    if (previous?.pendingSync) moved.pendingSync = previous.pendingSync;
    if (!previous || changedInWindow) markPendingSync(taskId);
  }

  /**
   * The target created the page of a moving task: the task takes its `externalId` and keeps `pendingMove` (the
   * origin copy is still to be removed) and its marker. A card that a fetch made from that very page before this
   * response was stored is a duplicate of the moving task and is dropped in the same mutation.
   * @returns the ids of the dropped duplicates
   */
  function completeMoveCreate(taskId: string, externalId: string): string[] {
    const moved = tasks.value.find((el) => el.id === taskId);
    if (!moved || moved.source === 'local') return [];
    moved.externalId = externalId;
    const duplicates = tasks.value.filter((el) => el.id !== taskId && el.source === moved.source && el.externalId === externalId);
    if (duplicates.length === 0) return [];
    const dropped = new Set(duplicates.map((el) => el.id));
    tasks.value = tasks.value.filter((el) => !dropped.has(el.id));
    for (const id of dropped) mapHelpers.delete(pendingTimeUpdates.value, id);
    pruneCarryOver(tasks.value.map((el) => el.id));
    useBoardStore().reconcileColumnsWithTasks(tasks.value);
    return [...dropped];
  }

  /** The move is finished: the origin copy is gone (or nothing was there to remove). */
  function clearPendingMove(taskId: string): void {
    const moved = tasks.value.find((el) => el.id === taskId);
    if (moved) delete moved.pendingMove;
  }

  /** Moves inside their undo window (not persisted): a push or a flush must not create them upstream yet. */
  const heldMoves = new Set<string>();
  /** Held moves whose task changed inside the window (not persisted): what Undo must push to the origin. */
  const heldChanged = new Set<string>();
  const holdMove = (taskId: string): void => { heldMoves.add(taskId); heldChanged.delete(taskId); };
  /** Ends the hold; the record of changes stays until `restoreMoveOrigin` reads it or the next hold resets it. */
  const releaseMove = (taskId: string): void => { heldMoves.delete(taskId); };
  const isMoveHeld = (taskId: string): boolean => heldMoves.has(taskId);

  function addPendingTimeUpdate(taskId: string, seconds: number) {
    // Only a source that stores time has anything to push (a Local or Todoist task's time is already complete)
    const owner = tasks.value.find((el) => el.id === taskId);
    if (owner && !sourceSyncsTime(owner.source)) return;
    const existing = mapHelpers.get(pendingTimeUpdates.value, taskId);
    
    if (existing) {
      existing.timeSpentSeconds += seconds;
    } else {
      mapHelpers.set(pendingTimeUpdates.value, taskId, createPendingTimeUpdate(taskId, seconds));
    }
  }

  function addTask(task: Task) {
    tasks.value.push(task);
  }

  /**
   * Plans a task for today (#353): drops its `notPlanned` marker, so it shows in Offen, at the end of the column's
   * stored order. Nothing else about the task changes (no `updatedAt`, no `pendingSync`: no connection holds the
   * marker). Returns whether the task was not planned before.
   */
  function planTask(taskId: string): boolean {
    return planTasks([taskId]).length > 0;
  }

  /**
   * Plans several tasks at once (#356, "Alle wieder einplanen"): they land at the end of Offen in the order given,
   * with one reconcile for the whole list. Ids that are unknown or already planned are skipped.
   * @returns the ids that were planned
   */
  function planTasks(taskIds: readonly string[]): string[] {
    const planned: string[] = [];
    for (const taskId of taskIds) {
      const target = tasks.value.find((el) => el.id === taskId);
      if (!target || !isNotPlanned(target) || planned.includes(taskId)) continue;
      delete target.notPlanned;
      planned.push(taskId);
    }
    if (planned.length === 0) return planned;
    const boardStore = useBoardStore();
    // The reconcile appends in stored order: put the list at the end of Offen in the order asked for
    boardStore.reconcileColumnsWithTasks(tasks.value);
    boardStore.moveToEndOfColumn(TaskStatus.Open, planned);
    return planned;
  }

  /**
   * Notes what the task's source holds it as (#357, `Task.sourceNotPlanned`): the status a put-back is written as,
   * or `undefined` once the source holds it as planned. Only `useTaskSync` calls this, around its own write.
   * @returns whether the value changed
   */
  function setSourceNotPlanned(taskId: string, held: string | undefined): boolean {
    const target = tasks.value.find((el) => el.id === taskId);
    if (!target || target.sourceNotPlanned === held) return false;
    if (held === undefined) delete target.sourceNotPlanned;
    else target.sourceNotPlanned = held;
    return true;
  }

  /**
   * "Not today" (#353): takes an Offen task off the board. It stays in `tasks` with its time, notes, topic,
   * priority, timebox, source and carried-over count, leaves Offen's order and goes to the top of "Meine Aufgaben" (#354). Only an Open task can be taken
   * off: any other status is refused (`false`), as is a task that is already not planned.
   */
  function unplanTask(taskId: string): boolean {
    return unplanTasks([taskId]).length > 0;
  }

  /**
   * Takes several Offen tasks off the board at once (#356; #387: the fresh start the user triggers): they go to the top of "Nicht
   * geplant" in the order given, with one reconcile for the whole list. The rule per task is `unplanTask`'s: only
   * an Open task that is still planned; every other id is skipped. Nothing else about a task changes.
   * @returns the ids that were taken off
   */
  function unplanTasks(taskIds: readonly string[]): string[] {
    const taken: string[] = [];
    for (const taskId of taskIds) {
      const target = tasks.value.find((el) => el.id === taskId);
      if (!target || target.status !== TaskStatus.Open || isNotPlanned(target)) continue;
      target.notPlanned = true;
      taken.push(taskId);
    }
    if (taken.length === 0) return taken;
    const boardStore = useBoardStore();
    boardStore.noteNotPlanned(taken);
    boardStore.reconcileColumnsWithTasks(tasks.value);
    return taken;
  }

  function removeTask(id: string) {
    restoreGuard.delete(id);
    writtenAt.delete(id);
    const taskIndex = tasks.value.findIndex((el) => el.id === id);
    if (taskIndex !== -1) {
      const [removed] = tasks.value.splice(taskIndex, 1);
      // Track deleted IDs to prevent resurrection on sync: the app-level id, and the integration's id
      // when it differs (a sync fetches the task by its externalId only)
      for (const deletedId of [id, removed?.externalId, removed?.pendingMove?.fromExternalId]) {
        if (deletedId && !deletedTaskIds.value.includes(deletedId)) {
          deletedTaskIds.value.push(deletedId);
        }
      }
    }
  }

  function replaceTasksWith(newTasks: Array<Task>) {
    tasks.value = newTasks;
  }

  /**
   * Updates the time spent on a task
   * @param payload containing taskId and timeSpentSeconds
   * @returns true if the task is found and updated, false otherwise
   */
  function updateTaskTimespent(payload: IUpdateTimeSpentPayload): boolean {
    const task = tasks.value.find((el) => el.id === payload.taskId);
    if (!task) {
      return false;
    }

    // Update local state using proper action
    updateTask(payload.taskId, { timeSpentSeconds: payload.timeSpentSeconds });

    // Store in pending updates if task is in progress (and its source stores time)
    if (task.status === TaskStatus.Progress && sourceSyncsTime(task.source)) {
      const existing = mapHelpers.get(pendingTimeUpdates.value, task.id);
      if (existing) {
        existing.timeSpentSeconds = payload.timeSpentSeconds;
      } else {
        mapHelpers.set(pendingTimeUpdates.value, task.id, createPendingTimeUpdate(task.id, payload.timeSpentSeconds));
      }
      return true;
    }

    // If task is moved out of progress, handle sync in the sync composable
    if (mapHelpers.has(pendingTimeUpdates.value, task.id)) {
      // Remove from pending updates - sync will be handled by composable
      mapHelpers.delete(pendingTimeUpdates.value, task.id);
    }

    return true;
  }

  /**
   * Writes seconds a task timer collected (#286, `lib/liveTime`): the one store write of a checkpoint. Unlike
   * `updateTaskTimespent` it queues the new total for a source that stores time whatever the task's status is
   * now: the stop flush of a task that just left Jetzt runs after its status changed, and that move must leave the
   * queued entry in place, as the last per-second tick did before the checkpoints.
   * A push of the task in flight (#313) counts as superseded by it: see `markPendingSync` revisions.
   * `awaySeconds` (of `seconds`): counted while the user was away from the window, in `awaySpans`; only those are
   * noted for the new day's check when a timer ran across midnight (#356).
   * @returns false for an unknown task, a count that is not a positive number, or while a batch operation holds updates
   */
  function addTrackedSeconds(
    taskId: string,
    seconds: number,
    awaySeconds = 0,
    awaySpans: ReadonlyArray<readonly [number, number]> = [],
  ): boolean {
    const task = tasks.value.find((el) => el.id === taskId);
    if (!task || !Number.isFinite(seconds) || seconds <= 0 || batchOperationInProgress.value) return false;

    const total = task.timeSpentSeconds + seconds;
    updateTask(taskId, { timeSpentSeconds: total });
    // A timer that ran across midnight: what it counts from there on while the user is away is noted for the new
    // day's check (#356, D3 o); a second counted with the user in the window is never noted
    const counted = validAfterMidnight.value;
    if (counted && counted.taskId === taskId) {
      const away = Number.isFinite(awaySeconds) ? Math.min(Math.max(0, awaySeconds), seconds) : 0;
      const spans = away > 0 ? normalizeSpans([...counted.spans, ...awaySpans], startOfDayMs(counted.day)) : counted.spans;
      afterMidnight.value = { ...counted, seconds: counted.seconds + away, spans };
    }

    if (sourceSyncsTime(task.source)) {
      // A push of this task in flight (or a marker from this session) started from the older total: a new revision,
      // so its echo does not lower the total and its landing keeps this entry (#313). No marker is made here.
      const revision = pendingSyncRevisions.get(taskId);
      if (revision !== undefined) pendingSyncRevisions.set(taskId, revision + 1);
      const existing = mapHelpers.get(pendingTimeUpdates.value, taskId);
      if (existing) {
        existing.timeSpentSeconds = total;
      } else {
        mapHelpers.set(pendingTimeUpdates.value, taskId, createPendingTimeUpdate(taskId, total));
      }
    }
    return true;
  }

  /**
   * A user's edit of a task's total time spent (kd#4). Unlike the timer tick (`updateTaskTimespent`, which
   * accumulates and queues only for a task in Jetzt) the edit is absolute, for any status: the total is
   * written at once and, for a source that stores time, queued as an `absolute` entry. While that entry
   * exists `mergeTasks` takes the local total over a higher fetched one, and the Notion push writes the time
   * property even at 0 (otherwise the old value would come back). A running timer keeps counting from the
   * new total; a done task's completion record follows through `updateTask`. Work sessions are not touched.
   * @returns false for an unknown task or a total that is negative or not a finite number
   */
  function setTimeSpent(taskId: string, seconds: number): boolean {
    const task = tasks.value.find((el) => el.id === taskId);
    if (!task || !Number.isFinite(seconds) || seconds < 0) return false;

    // The edit is the new total: the seconds a running timer has collected but not written (#286) are not added on top
    discardLiveSeconds(taskId);
    updateTask(taskId, { timeSpentSeconds: seconds });
    // The user's total is the truth from here on: nothing counted before it is taken off by a new day (#356)
    clearAfterMidnight(taskId);

    if (sourceSyncsTime(task.source)) {
      // A new revision, so a push already in flight does not clear this edit's entry when it lands
      markPendingSync(taskId);
      const existing = mapHelpers.get(pendingTimeUpdates.value, taskId);
      if (existing) {
        existing.timeSpentSeconds = seconds;
        existing.absolute = true;
      } else {
        mapHelpers.set(pendingTimeUpdates.value, taskId, { ...createPendingTimeUpdate(taskId, seconds), absolute: true });
      }
    }
    return true;
  }

  /**
   * The timer of `taskId` ran across the local midnight that starts `day` (#356): what it counts from now on is
   * noted. Replaces an older entry (another task, or an earlier midnight: only the last one counts). Nothing is noted
   * for a day whose check already ran in this page load (`settleAfterMidnight`).
   */
  function beginAfterMidnight(taskId: string, day: string): void {
    if (!isValidDayKey(day) || !tasks.value.some((el) => el.id === taskId)) return;
    // The check of that day already ran: the question covers only the time up to it
    if (day === afterMidnightSettledDay) return;
    const current = validAfterMidnight.value;
    if (current && current.taskId === taskId && current.day === day) return;
    afterMidnight.value = { taskId, day, seconds: 0, spans: [] };
  }

  /** Drops the noted seconds: of one task (it entered Jetzt anew, the user set its time) or, without an id, any. */
  function clearAfterMidnight(taskId?: string): void {
    if (afterMidnight.value === null) return;
    if (taskId === undefined || validAfterMidnight.value?.taskId === taskId || validAfterMidnight.value === null) afterMidnight.value = null;
  }

  /**
   * The check of `day` has read the note (#387): whatever is left of it is dropped, and no note for that day starts
   * any more (`beginAfterMidnight` refuses it), so a crossing the timer sees only after the check asks nothing later.
   */
  function settleAfterMidnight(day: string): void {
    clearAfterMidnight();
    if (isValidDayKey(day)) afterMidnightSettledDay = day;
  }

  /**
   * The new day's check (#356; `useNewDay().check`, #387): hands out the seconds the timer of `taskId` counted after the local midnight that
   * starts `day` while the user was away (with the wall-clock spans they were counted in) and drops the note, whatever
   * it held, so a second call returns nothing. Changes no time: the user decides what happens to them (the
   * question of `useNewDay`, the user's decision of 2026-11-16: nothing is removed silently). Call it after the timer
   * was stopped (the stop writes the collected seconds).
   * @returns the count, or null for another task or day, no note or a malformed one
   */
  function takeAfterMidnight(taskId: string, day: string): AfterMidnightCount | null {
    const counted = validAfterMidnight.value;
    clearAfterMidnight();
    if (!counted || counted.taskId !== taskId || counted.day !== day || !tasks.value.some((el) => el.id === taskId)) return null;
    return { ...counted, spans: counted.spans.map(([from, to]) => [from, to] as [number, number]) };
  }

  /**
   * "Zeit abziehen" (#356): takes `seconds` off the task's time spent again, never more than the task holds (never
   * below zero). The lowered total is written like a user's time edit (`setTimeSpent`), so a connection that stores
   * time receives it and a fetch cannot bring the higher one back. The caller makes it happen once (the offer is
   * cleared first) and cuts the work sessions.
   * @returns the seconds taken off
   */
  function takeOffSeconds(taskId: string, seconds: number): number {
    const task = tasks.value.find((el) => el.id === taskId);
    if (!task || !Number.isFinite(seconds)) return 0;
    // The answer can come after the task was planned and started again: what its running timer has collected but
    // not written yet belongs to the total (`setTimeSpent` discards it and writes the new total)
    const before = (Number.isFinite(task.timeSpentSeconds) ? Math.max(0, task.timeSpentSeconds) : 0) + liveSecondsOf(taskId);
    const removed = Math.min(Math.floor(seconds), before);
    if (removed <= 0) return 0;
    if (!setTimeSpent(taskId, before - removed)) return 0;
    return removed;
  }

  /**
   * The user's correction of a done task's completion time (kd#131, the done day of a task marked done late).
   * Sets `completedAt` and the `completedAtCorrected` marker, which keeps the time over what the task's source
   * returns while the task stays done (`mergeTasks`). The caller (`useTaskSync.setCompletedDay`) checks the
   * limits, moves the completion record and pushes to the source; work sessions and time spent are not touched.
   * @returns false for an unknown task, a task that is not done or an invalid date
   */
  function setCompletedAt(taskId: string, completedAt: Date): boolean {
    const task = tasks.value.find((el) => el.id === taskId);
    if (!task || task.status !== TaskStatus.Done || Number.isNaN(completedAt.getTime())) return false;
    updateTask(taskId, { completedAt, completedAtCorrected: true });
    // A new revision, so a push already in flight does not mark this edit as pushed
    markPendingSync(taskId);
    return true;
  }

  /**
   * Clear pending time updates for a specific task
   */
  function clearPendingTimeUpdate(taskId: string) {
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
  }

  /**
   * Clear all pending time updates
   */
  function clearAllPendingTimeUpdates(): void {
    pendingTimeUpdates.value = {};
  }

  /**
   * Set tasks array (replaces all tasks)
   * Also extracts and populates property options for select fields
   */
  function setTasks(tasksArray: Task[]): void {
    const boardStore = useBoardStore();
    tasks.value = tasksArray;
    boardStore.reconcileColumnsWithTasks(tasksArray);
    
    // Auto-populate property options store from tasks
    const propertyOptionsStore = usePropertyOptionsStore();
    propertyOptionsStore.extractOptionsFromTasks(tasksArray);
  }

  /**
   * Turns the tasks of every source except `keep` into Local tasks (same `id`, no `externalId`), pending
   * deletes in their undo window included. A switch away from an integration keeps the board's tasks and
   * never writes upstream to it again, as before #326 (the service changed, the tasks stayed).
   */
  function adoptAsLocal(keep: SourceId | null = null): void {
    const stays = (task: Pick<Task, 'source' | 'externalId'>) =>
      task.source === 'local' ? task.externalId === null : task.source === keep;
    // Nothing goes upstream any more, so the marker (and a move) goes with the source
    const adopt = (task: Task): Task => {
      if (stays(task)) return task;
      const { pendingSync: _sync, pendingMove: _move, ...rest } = task;
      return { ...rest, source: 'local', externalId: null };
    };
    if (!tasks.value.every(stays)) tasks.value = tasks.value.map(adopt);
    for (const pending of Object.values(pendingDeletes.value)) {
      if (!stays(pending.task)) pending.task = adopt(pending.task);
    }
  }

  /**
   * Starts a switch of the board to one integration (welcome, Notion setup, Todoist OAuth): that source
   * becomes the only one, the other sources' tasks become Local tasks right away (nothing goes upstream
   * to a source the user left), and the board is flagged so the first non-empty fetch replaces them.
   */
  function beginSourceSwitch(source: IntegrationSourceId): void {
    const boardStore = useBoardStore();
    boardStore.setSingleSource(source);
    boardStore.markSourceSwitchPending();
    adoptAsLocal(source);
  }

  /**
   * Unsynced work of one integration that a disconnect would discard: its tasks the source does not hold
   * yet (marker or queued time) or that are being timed (the stop queues their time), and its deletes that
   * have not reached it. Counted per task, a task with several reasons counts once.
   */
  function unsyncedOf(source: SourceId): { taskIds: string[]; pendingDeleteIds: string[] } {
    const taskIds = tasks.value
      .filter((el) => el.source === source && (isSyncPending(el.id) || (!!el.timerId && el.status === TaskStatus.Progress)))
      .map((el) => el.id);
    const pendingDeleteIds = Object.values(pendingDeletes.value)
      .filter((pending) => pending.task.source === source && pending.task.externalId !== null)
      .map((pending) => pending.taskId);
    return { taskIds, pendingDeleteIds };
  }

  /**
   * Takes one integration off the board (#320): stops the timers of its tasks (their intervals; the time
   * stays queued as an unsynced change until the tasks go), removes the tasks and everything keyed by their
   * ids that is not history (column order and positions, carry-over, archive, queued time, pending deletes,
   * operation versions, status locks, markers), and removes the source from `connected` (the default falls
   * back to Local). Statistics records stay: statistics ignore sources. Deleted-id guards of its queued
   * deletes go too, so a reconnect shows the database as it is (a fresh connect). Credentials are the
   * caller's job (`useSourceConnections`, Keychain first).
   * @returns the ids of the removed tasks
   */
  function disconnectSource(source: IntegrationSourceId): string[] {
    const boardStore = useBoardStore();
    const leaving = tasks.value.filter((el) => el.source === source);
    const ids = new Set(leaving.map((el) => el.id));

    for (const leavingTask of leaving) {
      disarmTaskTimer(leavingTask.id);
      statusLocks.delete(leavingTask.id);
      pendingSyncRevisions.delete(leavingTask.id);
      mapHelpers.delete(pendingTimeUpdates.value, leavingTask.id);
      mapHelpers.delete(taskOperationVersions.value, leavingTask.id);
    }
    // A delete that never reached the source: its undo (if the toast is still open) finds nothing to restore
    for (const pending of Object.values(pendingDeletes.value)) {
      if (pending.task.source !== source) continue;
      ids.add(pending.taskId);
      undeleteTask(pending.taskId, pending.task.externalId, pending.task.pendingMove?.fromExternalId);
      mapHelpers.delete(pendingDeletes.value, pending.taskId);
    }

    const remaining = tasks.value.filter((el) => el.source !== source);
    tasks.value = remaining;
    archivedTaskIds.value = archivedTaskIds.value.filter((id) => !ids.has(id));
    for (const id of ids) mapHelpers.delete(carryOverByTaskId.value, id);
    for (const index of Object.values(customPropertyIndexes.value)) {
      for (const valueKey of Object.keys(index.taskIdsByValue)) {
        index.taskIdsByValue[valueKey] = (index.taskIdsByValue[valueKey] ?? []).filter((id) => !ids.has(id));
      }
    }
    boardStore.disconnectIntegration(source);
    boardStore.reconcileColumnsWithTasks(remaining);
    return [...ids];
  }

  /**
   * Replaces the tasks of one source with `fetchedTasks`, leaving every other source's tasks untouched.
   * Existing tasks are matched by `(source, externalId)` (`id` for Local, which has no externalId), so a
   * task keeps its app-level `id` whatever the integration calls it. A new external task gets
   * `id = externalId` unless that id is already taken (then a generated one). Preserves local time
   * tracking, timers and in-flight status locks; skips tasks deleted locally.
   * @param source The source the tasks were fetched from (Notion, Todoist, ...)
   * @param fetchedTasks Tasks from that source's integration
   * @param options `replaceOthers` drops the Local tasks too, as the single-service merge did before #326:
   *   set by the fetch that completes a source switch (`pendingSourceSwitch`); the tasks of another
   *   connected integration stay (a connect during a pending switch, #320). A Local task
   *   whose `id` equals a fetched `externalId` is that task (a Notion -> Local -> Notion round trip): it
   *   keeps its `id` and local data and takes the source and `externalId` again. `heldTime` maps a local total
   *   to the total the source reads back for it (a unit rounding, `TaskSourceAdapter.timeHolding`): a fetched
   *   value equal to that is the local total, so it is kept as it is and queues no push (#323). `timeWritable: false`
   *   (`TaskSourceAdapter.timeWritable`, a Notion select time property, #331): the source takes no time write, so
   *   local time above the fetched value queues no push. `holdsOnlyOpenDone` (`TaskSourceAdapter.holdsOnlyOpenDone`,
   *   Todoist): the source knows no Jetzt or Wartet, so a task it reports as open keeps the column kan-do holds it in.
   *   `startsNotPlanned` (`TaskSourceAdapter.startsNotPlanned`, Todoist, #357): an Open task seen for the first time
   *   starts not planned; a task already held is never moved by it (#387: the app moves no card by itself).
   *   `fetchStartedAt` (epoch ms, when the fetch began) and `pushing` (whether a write of a task is under way now,
   *   `useTaskSync.isPushing`): a task written since the fetch began, or being written, stays as it is when the
   *   list lacks it, because the list may have been read before the write (#357); the next fetch decides. A task the
   *   list contains is held the same way: the list is older than the write, so the task keeps its local state and only
   *   takes the source's `externalId` (#390).
   *   `readInParts` (`FetchedTasks.readInParts`, #392): the list was assembled from more than one read (Notion's board
   *   query, then its "not planned" query), so a page moved between the reads is in none. A task the list lacks is kept
   *   once then, and goes when the next merge's list lacks it too; a task written since the fetch began is kept once
   *   the same way (a push that keeps failing must not keep it for ever). `confirmedDrop` (the user answered "Ja" to
   *   the sync question for this list, #369): the question named the tasks the list lacks, so they go at once and
   *   the keep-once above does not apply to them; a task written since the fetch began or being written stays.
   *   `partialNotPlanned` (`FetchedTasks.partialNotPlanned`, Notion's capped "not planned" list, #357): for a task
   *   held as one of these values `fetchedTasks` is only a part of what the source holds. Such a task that the list
   *   lacks stays as it is, and so does a task with unpushed changes; every other task the list lacks is dropped.
   */
  function mergeTasks(source: SourceId, fetchedTasks: Task[], options: { replaceOthers?: boolean; heldTime?: (seconds: number) => number; timeWritable?: boolean; holdsOnlyOpenDone?: boolean; startsNotPlanned?: boolean; partialNotPlanned?: readonly string[]; readInParts?: boolean; confirmedDrop?: boolean; fetchStartedAt?: number; pushing?: (taskId: string) => boolean } = {}): void {
    const boardStore = useBoardStore();

    // A completed switch replaces the Local tasks it adopted; another connected integration's tasks stay (#320)
    const otherTasks = tasks.value.filter(task => task.source !== source && !(options.replaceOthers && task.source === 'local'));
    const keyOf = (task: Pick<Task, 'id' | 'externalId'>) => task.externalId ?? task.id;
    const existingBySourceKey = new Map<string, Task>();
    tasks.value.forEach(task => {
      // A task moved here whose page is not created yet cannot match a fetched page (its id may equal the origin page's)
      const awaitsCreate = task.pendingMove !== undefined && task.externalId === null;
      if (task.source === source && !(source !== 'local' && awaitsCreate)) existingBySourceKey.set(keyOf(task), task);
      else if (options.replaceOthers && task.source === 'local' && source !== 'local' && !existingBySourceKey.has(task.id)) {
        existingBySourceKey.set(task.id, task);
      }
    });
    const takenIds = new Set(tasks.value.map(task => task.id));
    // The origin pages of moves that are not finished (#322): the task already lives in another source, so the
    // page this source still returns for it is not a new task
    const movedAwayPages = new Set<string>();
    for (const task of tasks.value) {
      if (task.pendingMove?.fromSource === source && task.pendingMove.fromExternalId !== null) movedAwayPages.add(task.pendingMove.fromExternalId);
    }

    // A list is older than every write that ended after the fetch began (strictly: a write that ended in the
    // millisecond the fetch began was there before its first read) and than a write still under way (#357, #390)
    const fetchStartedAt = options.fetchStartedAt;
    const writtenSinceFetch = (taskId: string): boolean =>
      (fetchStartedAt !== undefined && (writtenAt.get(taskId) ?? 0) > fetchStartedAt) || options.pushing?.(taskId) === true;

    const mergedTasks: Task[] = [];
    fetchedTasks.forEach(fetchedFrom => {
      const fetchedTask: Task = { ...fetchedFrom, source, externalId: source === 'local' ? null : (fetchedFrom.externalId ?? fetchedFrom.id) };
      if (fetchedTask.externalId !== null && movedAwayPages.has(fetchedTask.externalId)) return;
      const existingTask = existingBySourceKey.get(keyOf(fetchedTask));
      const resolvedId = existingTask?.id ?? fetchedTask.id;

      // Skip tasks that were deleted locally
      if ([resolvedId, fetchedTask.id, fetchedTask.externalId].some(candidate => candidate !== null && deletedTaskIds.value.includes(candidate))) {
        console.log(`Skipping deleted task ${resolvedId} during merge`);
        return;
      }

      if (existingTask) {
        // Preserve local time tracking data and timer state
        const localTimeSpent = existingTask.timeSpentSeconds || 0;
        const externalTimeSpent = fetchedTask.timeSpentSeconds || 0;
        const pendingUpdate = mapHelpers.get(pendingTimeUpdates.value, resolvedId);
        const pendingLocal = pendingUpdate?.timeSpentSeconds || 0;
        // A total the user set (kd#4) wins over the fetched one, also when it is lower; otherwise the larger value stays
        const userSetTime = pendingUpdate?.absolute === true;
        const effectiveLocal = userSetTime ? localTimeSpent : Math.max(localTimeSpent, pendingLocal);
        // The source rounds time to its unit: a fetched value that is the local total as it holds it is that total,
        // not a lower (or higher) one, so the exact local seconds stay and nothing is pushed again (#323)
        const heldAsLocal = effectiveLocal > 0 && options.heldTime?.(effectiveLocal) === externalTimeSpent;

        // A task with unpushed changes (#319) keeps its local state: the fetch is older than the edit, and the
        // push that follows would otherwise send the source's stale copy back. Only the source's id is taken.
        // What the source says now also corrects the marker's note of whether it holds the task as completed (#344)
        const marker = existingTask.pendingSync;
        const heldDone = fetchedTask.status === TaskStatus.Done;
        // The same for a task written since this fetch began (#390): the list was read before the write (or while
        // it was on its way), so it carries the older state; the next fetch decides
        const base: Task = marker
          ? {
            ...existingTask,
            externalId: fetchedTask.externalId,
            ...(marker.upstreamDone !== undefined && marker.upstreamDone !== heldDone ? { pendingSync: { ...marker, upstreamDone: heldDone } } : {}),
          }
          : source !== 'local' && writtenSinceFetch(existingTask.id)
            ? { ...existingTask, externalId: fetchedTask.externalId }
            : fetchedTask;

        // Merge task: use fetched data but preserve local time tracking
        const mergedTask: Task = {
          ...base, // Use all fetched data as base
          id: existingTask.id, // The app-level identity never changes
          createdAt: earlierCreatedAt(existingTask.createdAt, base.createdAt), // A moved task keeps its first creation time
          // Keep the highest value across external and effective local (including pending)
          timeSpentSeconds: userSetTime || heldAsLocal ? effectiveLocal : Math.max(effectiveLocal, externalTimeSpent),
          timerId: existingTask.timerId, // Preserve active timer
        };

        // A source without Jetzt and Wartet (Todoist) says "open" for them too: the column is kan-do's (#357)
        if (options.holdsOnlyOpenDone && mergedTask.status === TaskStatus.Open
          && (existingTask.status === TaskStatus.Progress || existingTask.status === TaskStatus.Waiting)) {
          mergedTask.status = existingTask.status;
        }

        // Keep an in-flight local status change (e.g. an undone completion)
        const statusLock = statusLocks.get(resolvedId);
        if (statusLock) {
          mergedTask.status = statusLock.status;
          mergedTask.completedAt = statusLock.completedAt;
        }

        // "Not planned" (#353) is kan-do's own state: the held task's marker stays, but only while the task is still
        // Open after the merge (the source moved it on: it is on the board). A source with a planning state of its
        // own (#357) moves the task only when that state changed there since the last fetch: it holds the task as
        // not planned now and did not before, or the other way round (which "not planned" status it is does not
        // matter: Backlog to Someday is no move). The same answer as last time leaves kan-do's marker alone, so a
        // task kan-do planned or put back by itself stays where it is. `base` already carries what the source holds
        // now (the local value while a push is outstanding)
        const heldBefore = existingTask.sourceNotPlanned;
        const heldNow = mergedTask.sourceNotPlanned;
        if (heldNow === undefined) delete mergedTask.sourceNotPlanned;
        const sourceMoved = (heldBefore !== undefined) !== (heldNow !== undefined);
        const notPlannedNow = sourceMoved
          ? heldNow !== undefined && mergedTask.status === TaskStatus.Open
          : existingTask.notPlanned === true && markerSurvives(existingTask.status, mergedTask.status);
        if (notPlannedNow) mergedTask.notPlanned = true;
        else delete mergedTask.notPlanned;

        // A done day the user corrected (kd#131) outlives the fetch while both sides hold the task as done: a
        // source without a completion date would report "now", one with a date may still hold the old day
        if (existingTask.completedAtCorrected && existingTask.completedAt && existingTask.status === TaskStatus.Done && mergedTask.status === TaskStatus.Done) {
          mergedTask.completedAt = existingTask.completedAt;
          mergedTask.completedAtCorrected = true;
        }

        // If effective local (local or pending) is greater than external, ensure pending reflects the highest local value
        if (effectiveLocal > externalTimeSpent && effectiveLocal > 0 && !heldAsLocal && options.timeWritable !== false && sourceSyncsTime(source)) {
          const existing = mapHelpers.get(pendingTimeUpdates.value, resolvedId);
          if (existing) {
            existing.timeSpentSeconds = Math.max(existing.timeSpentSeconds, effectiveLocal);
          } else {
            mapHelpers.set(pendingTimeUpdates.value, resolvedId, createPendingTimeUpdate(resolvedId, effectiveLocal));
          }
        }

        mergedTasks.push(mergedTask);
      } else {
        // New task from the source: its externalId becomes the id unless another task already uses it
        const id = takenIds.has(fetchedTask.id) ? generateTaskId() : fetchedTask.id;
        takenIds.add(id);
        // A task seen for the first time starts where its source holds it (#357), or not planned when the source
        // has no planning of its own and says so (`startsNotPlanned`); the marker is never the fetch's own
        const { notPlanned: _fetchedMarker, ...fresh } = fetchedTask;
        const startsNotPlanned = (fresh.sourceNotPlanned !== undefined || options.startsNotPlanned === true) && fresh.status === TaskStatus.Open;
        mergedTasks.push({ ...fresh, id, ...(startsNotPlanned ? { notPlanned: true as const } : {}) });
      }
    });

    // A task restored from the trash (#422, D5): a fetch that started before the restore finished does not
    // contain it, so it stays; one that contains it ends the guard (the merge above matched it normally).
    const guardNow = Date.now();
    for (const local of tasks.value) {
      const guardedAt = restoreGuard.get(local.id);
      if (guardedAt === undefined) continue;
      if (guardNow - guardedAt > RESTORE_GUARD_MS || mergedTasks.some(merged => merged.id === local.id)) {
        restoreGuard.delete(local.id);
      } else if (local.source === source) {
        mergedTasks.push(local);
      }
    }

    // A task made while the source was unreachable is not upstream yet (#319): the fetch cannot know it
    if (source !== 'local') {
      for (const local of tasks.value) {
        if (local.source === source && local.externalId === null && local.pendingSync && !mergedTasks.some(merged => merged.id === local.id)) {
          mergedTasks.push(local);
        }
      }
    }

    // A list says that a task is gone only when it was read after the task's last write (#357). A source read in
    // more than one query (Notion: the board, then "not planned") has a write that takes the page out of "not
    // planned" in neither answer when it lands between the two reads. So a task written since this fetch began, or
    // being written now, stays as it is, with what only kan-do holds (time, order, the carried-over count); the
    // next fetch read the source after the write and decides.
    // The same goes for a page the user moved at the source itself between the two reads (#392): a list read in
    // parts (`readInParts`) says "gone" only when the list before it lacked the task too.
    // Either way a task is kept once: a task the previous merge already kept is dropped now, so a push that keeps
    // failing (it stamps a write on every tick) does not keep a task gone at its source for ever.
    // A capped list (Notion's most recently edited "not planned" pages) is a part of what the source holds on top
    // of that. A task held in one of its statuses that the list lacks may only be past the cap: it stays as it is.
    // A task with unpushed changes stays too: its page may be past the cap while the change that takes it out of
    // there (a plan made offline) still waits. Everything else the list lacks is gone at the source (the board
    // query is never capped).
    if (source !== 'local') {
      const partial = options.partialNotPlanned ?? [];
      const lackedBefore = lackedByLastMerge.get(source);
      const lackedNow = new Set<string>();
      const mergedIds = new Set(mergedTasks.map(merged => merged.id));
      for (const local of tasks.value) {
        if (local.source !== source || local.externalId === null || mergedIds.has(local.id)) continue;
        const heldPastCap = local.sourceNotPlanned !== undefined && partial.includes(local.sourceNotPlanned);
        if (partial.length > 0 && (heldPastCap || local.pendingSync !== undefined)) {
          mergedTasks.push(local);
        } else if (lackedBefore?.has(local.id) !== true && ((options.readInParts === true && options.confirmedDrop !== true) || writtenSinceFetch(local.id))) {
          mergedTasks.push(local);
          lackedNow.add(local.id);
        }
      }
      lackedByLastMerge.set(source, lackedNow);
    }

    // Replace this source's tasks with the merged results
    const allTasks = [...otherTasks, ...mergedTasks];
    tasks.value = allTasks;
    pruneCarryOver(allTasks.map(t => t.id));
    boardStore.reconcileColumnsWithTasks(allTasks);

    // Auto-populate property options store from the merged tasks
    const propertyOptionsStore = usePropertyOptionsStore();
    propertyOptionsStore.extractOptionsFromTasks(allTasks);

    console.log(`Merged ${fetchedTasks.length} ${source} tasks, preserved local time data for ${mapHelpers.size(pendingTimeUpdates.value)} tasks`);

    // Backfill statistics from Done tasks after merge (use dynamic import to avoid circular dependency)
    const doneTasks = mergedTasks.filter(t => t.status === TaskStatus.Done);
    if (doneTasks.length > 0) {
      import('~/store/taskStatistics').then(({ useTaskStatisticsStore }) => {
        const statisticsStore = useTaskStatisticsStore();
        statisticsStore.syncExistingDoneTasks(doneTasks, archivedTaskIds.value);
      }).catch((error) => {
        console.warn('Failed to sync statistics after merge:', error);
      });
    }
  }

  /**
   * Set loading state
   */
  function setLoading(loading: boolean): void {
    if (import.meta.dev) {
      console.log('[TasksStore] setLoading:', loading, new Error().stack?.split('\n')[2]?.trim());
    }
    isLoading.value = loading;
  }

  /**
   * Set last sync timestamp
   */
  function setLastSyncTimestamp(timestamp: Date): void {
    lastSyncTimestamp.value = timestamp;
  }

  /**
   * Update last sync timestamp
   */
  function updateLastSyncTimestamp() {
    lastSyncTimestamp.value = new Date();
  }

  /**
   * Archive tasks (local UI-only state)
   * @param taskIds Array of task IDs to archive
   */
  function archiveTasks(taskIds: string[]): void {
    // Add to archived list
    const newArchived = taskIds.filter(id => !archivedTaskIds.value.includes(id));
    archivedTaskIds.value.push(...newArchived);

    // Mark archived timestamp on tasks
    taskIds.forEach(id => {
      updateTask(id, { archivedAt: new Date() });
    });

    if (import.meta.dev) {
      console.log(`Archived ${taskIds.length} tasks locally`);
    }
  }

  /**
   * Unarchive tasks (for undo functionality)
   * @param taskIds Array of task IDs to unarchive
   */
  function unarchiveTasks(taskIds: string[]): void {
    // Remove from archived list
    archivedTaskIds.value = archivedTaskIds.value.filter(
      id => !taskIds.includes(id)
    );

    // Clear archived timestamp
    taskIds.forEach(id => {
      updateTask(id, { archivedAt: null });
    });

    if (import.meta.dev) {
      console.log(`Unarchived ${taskIds.length} tasks`);
    }
  }

  /**
   * Mark a pending update as syncing
   */
  function markPendingUpdateSyncing(taskId: string): void {
    const update = mapHelpers.get(pendingTimeUpdates.value, taskId);
    if (update) {
      update.status = 'syncing';
      update.lastAttemptAt = new Date();
      update.attemptCount++;
    }
  }

  /**
   * Mark a pending update as failed
   */
  function markPendingUpdateFailed(taskId: string, errorMessage: string): void {
    const update = mapHelpers.get(pendingTimeUpdates.value, taskId);
    if (update) {
      update.status = 'failed';
      update.errorMessage = errorMessage;
      update.lastAttemptAt = new Date();
    }
  }

  /**
   * Clean up stale pending updates (older than 7 days)
   */
  function cleanupStalePendingUpdates(): void {
    const toRemove: string[] = [];
    mapHelpers.forEach(pendingTimeUpdates.value, (update, taskId) => {
      if (shouldCleanupPendingUpdate(update)) {
        toRemove.push(taskId);
      }
    });
    
    toRemove.forEach(taskId => {
      mapHelpers.delete(pendingTimeUpdates.value, taskId);
    });
    
    if (toRemove.length > 0 && import.meta.dev) {
      console.log(`Cleaned up ${toRemove.length} stale pending updates`);
    }
  }

  /**
   * Rebuild custom property index for a specific property key
   */
  function rebuildCustomPropertyIndex(propertyKey: string): void {
    const index = createCustomPropertyIndex(propertyKey, 'text'); // Default type
    
    tasks.value.forEach(task => {
      const entry = task.custom?.[propertyKey];
      if (!entry) return;
      
      // Update type from first occurrence
      if (tasks.value.indexOf(task) === 0) {
        index.valueType = entry.propType;
      }
      
      const valueKey = extractValueKey(entry.value);
      if (!index.taskIdsByValue[valueKey]) {
        index.taskIdsByValue[valueKey] = [];
      }
      setHelpers.add(index.taskIdsByValue[valueKey], task.id);
    });
    
    customPropertyIndexes.value[propertyKey] = index; // Direct assignment instead of mapHelpers.set
    
    if (import.meta.dev) {
      console.log(`Rebuilt index for property: ${propertyKey}`);
    }
  }

  /**
   * Get tasks filtered by custom property value
   */
  function getTasksWithCustomValue(propertyKey: string, valueName: string): Task[] {
    const index = customPropertyIndexes.value[propertyKey];
    if (!index) {
      // Index doesn't exist, build it on demand
      rebuildCustomPropertyIndex(propertyKey);
      const newIndex = customPropertyIndexes.value[propertyKey];
      if (!newIndex) return [];
      const taskIds = newIndex.taskIdsByValue[valueName] || [];
      return tasks.value.filter(t => taskIds.includes(t.id));
    }
    
    const taskIds = index.taskIdsByValue[valueName] || [];
    return tasks.value.filter(t => taskIds.includes(t.id));
  }

  /**
   * Clear all custom property indexes
   */
  function clearCustomPropertyIndexes(): void {
    customPropertyIndexes.value = {};
  }

  /**
   * Increment operation version for a task
   */
  function incrementTaskOperationVersion(taskId: string): number {
    const current = taskOperationVersions.value[taskId] || 0;
    const next = current + 1;
    taskOperationVersions.value[taskId] = next;
    return next;
  }
  
  /**
   * Batch update status for multiple tasks atomically
   * This prevents re-grouping between individual updates
   */
  function batchUpdateTaskStatus(taskIds: string[], status: TaskStatus): void {
    // Set batch operation flag to prevent any updates during batch
    batchOperationInProgress.value = true;
    
    // Create a new array for atomic update
    const newTasks = [...tasks.value];
    const taskIdsSet = new Set(taskIds);
    
    // Update tasks in the new array
    for (let i = 0; i < newTasks.length; i++) {
      const currentTask = newTasks[i];
      if (currentTask && taskIdsSet.has(currentTask.id)) {
        const task: Task = { ...currentTask, status };
        // "Not planned" (#353) only survives Open -> Open, and what the source held it as (#357) with it, as in `updateTask`
        if (!markerSurvives(currentTask.status, status)) {
          delete task.notPlanned;
          delete task.sourceNotPlanned;
        }

        // Track completion timestamp when moved to Done
        if (status === TaskStatus.Done && currentTask.status !== TaskStatus.Done) {
          task.completedAt = new Date();
          delete task.completedAtCorrected;
        }
        // Clear completion timestamp if moved out of Done
        if (status !== TaskStatus.Done && currentTask.status === TaskStatus.Done) {
          task.completedAt = null;
          delete task.completedAtCorrected;
        }
        
        newTasks[i] = task;
      }
    }
    
    // Apply all updates in a single reactivity trigger
    tasks.value = newTasks;
    
    // Clear batch flag after a delay to allow sync to complete
    setTimeout(() => {
      batchOperationInProgress.value = false;
    }, 2000);
  }

  /**
   * Pins a task's status/completedAt against merges until the returned token is passed to
   * `unlockTaskStatus`. A later lock on the same task supersedes this one. Returns null when the
   * task does not exist (nothing to pin; unlocking null is a no-op).
   */
  function lockTaskStatus(taskId: string): number | null {
    const current = tasks.value.find((el) => el.id === taskId);
    if (!current) return null;
    const token = ++nextStatusLockToken;
    statusLocks.set(taskId, { token, status: current.status, completedAt: current.completedAt ?? null });
    return token;
  }

  /** Releases the lock `token` owns; a no-op once a newer lock has superseded it. */
  function unlockTaskStatus(taskId: string, token: number | null): void {
    if (token !== null && statusLocks.get(taskId)?.token === token) {
      statusLocks.delete(taskId);
    }
  }

  /**
   * Get current operation version for a task
   */
  function getTaskOperationVersion(taskId: string): number {
    return taskOperationVersions.value[taskId] || 0;
  }

  /**
   * Counts the current board day for every not-done task (#99). Idempotent within a day:
   * a task first seen today starts at 0, a later day adds one, Done (or archived) drops the counter,
   * and ids no longer on the board are pruned.
   * @param today Local date key (YYYY-MM-DD)
   */
  function recordCarryOver(today: string): void {
    const next: Record<string, CarryOverEntry> = {};
    for (const current of tasks.value) {
      if (current.status === TaskStatus.Done || archivedTaskIds.value.includes(current.id)) continue;
      const entry = mapHelpers.get(carryOverByTaskId.value, current.id);
      // A day a task is not planned (#353) is no board day: its count is kept as it is and runs on once it is
      // planned again; a task that was never on the board has none yet
      if (isNotPlanned(current)) {
        if (entry) next[current.id] = entry;
        continue;
      }
      next[current.id] = entry ? advanceCarryOverEntry(entry, today) : createCarryOverEntry(today);
    }
    carryOverByTaskId.value = next;
  }

  /**
   * The fresh start (#387) took these tasks off the board on `today`: a board day already counted for `today` is
   * taken back, so the day counts only for what the user plans again (`recordCarryOver` then counts it anew). An
   * entry first seen today, or last counted on an earlier day, stays as it is. `lastOn` becomes the day before:
   * the real earlier day is not kept, and any day before today reads the same for the next count.
   */
  function takeBackCarryOver(taskIds: readonly string[], today: string): void {
    if (!isValidDayKey(today)) return;
    const [year, month, day] = today.split('-').map(Number) as [number, number, number];
    const before = localDateKey(new Date(year, month - 1, day - 1));
    for (const taskId of taskIds) {
      const entry = mapHelpers.get(carryOverByTaskId.value, taskId);
      if (!entry || entry.lastOn !== today || entry.days <= 0) continue;
      mapHelpers.set(carryOverByTaskId.value, taskId, { ...entry, days: entry.days - 1, lastOn: before });
    }
  }

  /** Drops counters for task ids that are not in `taskIds`. */
  function pruneCarryOver(taskIds: string[]): void {
    const keep = new Set(taskIds);
    for (const id of mapHelpers.keys(carryOverByTaskId.value)) {
      if (!keep.has(id)) mapHelpers.delete(carryOverByTaskId.value, id);
    }
  }

  /**
   * Sets the counters of several tasks at once (#536): the demo board's samples come with theirs. Entries of other
   * tasks stay as they are; an id in `entries` replaces its counter.
   */
  function setCarryOver(entries: Record<string, CarryOverEntry>): void {
    carryOverByTaskId.value = { ...carryOverByTaskId.value, ...entries };
  }

  /** Keep (#99): silences the nudge until CARRY_OVER_NUDGE_DAYS further days; the count runs on. */
  function keepCarryOver(taskId: string): void {
    const entry = mapHelpers.get(carryOverByTaskId.value, taskId);
    if (entry) mapHelpers.set(carryOverByTaskId.value, taskId, { ...entry, keptAtDays: entry.days });
  }

  /** Restores a counter snapshot (undo of a delete). */
  function restoreCarryOver(taskId: string, entry: CarryOverEntry | null): void {
    if (entry) mapHelpers.set(carryOverByTaskId.value, taskId, entry);
  }

  /**
   * Rewrites a topic or activity name on every task, whatever its status, and on the task snapshots of the
   * deletes still inside their undo window (#430). Both names are trimmed by the caller. A dedicated action,
   * not `updateTask`: a rename is local bookkeeping, so it sets no `pendingSync`, bumps no revision and
   * leaves `updatedAt` alone. Returns how many tasks (snapshots included) changed; nothing matching is a no-op.
   */
  function renameValue(kind: NameKind, from: string, to: string): number {
    let changed = 0;
    tasks.value = tasks.value.map((task) => {
      const renamed = renameField(task, kind, from, to);
      if (renamed !== task) changed += 1;
      return renamed;
    });
    for (const pending of Object.values(pendingDeletes.value)) {
      const renamed = renameField(pending.task, kind, from, to);
      if (renamed === pending.task) continue;
      changed += 1;
      mapHelpers.set(pendingDeletes.value, pending.taskId, { ...pending, task: renamed });
    }
    return changed;
  }

  function addPendingDelete(pending: PendingTaskDelete): void {
    mapHelpers.set(pendingDeletes.value, pending.taskId, pending);
  }

  function removePendingDelete(taskId: string): void {
    mapHelpers.delete(pendingDeletes.value, taskId);
  }

  function markPendingDeleteQueued(taskId: string): void {
    const pending = mapHelpers.get(pendingDeletes.value, taskId);
    if (pending) mapHelpers.set(pendingDeletes.value, taskId, { ...pending, state: 'queued' });
  }

  /** Replaces the gap slot of a pending delete (#438: its anchor's gap ended); no-op when it is gone. */
  function setPendingDeleteSlot(taskId: string, slot: NonNullable<PendingTaskDelete['slot']>): void {
    const pending = mapHelpers.get(pendingDeletes.value, taskId);
    if (pending) mapHelpers.set(pendingDeletes.value, taskId, { ...pending, slot });
  }

  /** Guards a task that was just restored from the trash against a fetch that started before (#422, D5). */
  function guardRestoredTask(id: string): void {
    restoreGuard.set(id, Date.now());
  }

  /**
   * Also remove from deleted list if task is re-added via undo. The single guard-clearing function: a trashed
   * task stays blocked in `deletedTaskIds` (no fetch re-adds it) until this runs for it (#422).
   */
  function undeleteTask(id: string, externalId?: string | null, originExternalId?: string | null) {
    for (const deletedId of [id, externalId, originExternalId]) {
      const index = deletedId ? deletedTaskIds.value.indexOf(deletedId) : -1;
      if (index > -1) {
        deletedTaskIds.value.splice(index, 1);
      }
    }
  }

  return {
    // State
    tasks,
    isLoading,
    lastSyncTimestamp,
    pendingTimeUpdates,
    archivedTaskIds,
    deletedTaskIds,
    customPropertyIndexes,
    taskOperationVersions,
    carryOverByTaskId,
    pendingDeletes,
    afterMidnight,
    
    // Getters
    validAfterMidnight,
    task,
    tasksOpen,
    tasksProgress,
    tasksWaiting,
    tasksDone,
    tasksNotPlanned,
    tasksDoneToday,
    tasksDonePrevious,
    archivableTaskCount,
    archivedTaskCount,
    hasPendingTimeUpdates,
    isSyncPending,
    pendingSyncTasks,
    hasPendingSync,
    hasMultipleSources,
    failedPendingUpdates,
    pendingUpdateStats,
    
    // Actions
    updateTask,
    addPendingTimeUpdate,
    markPendingSync,
    pendingSyncRevision,
    clearPendingSync,
    recordPendingSyncFailure,
    completeCreate,
    markCreateUncertain,
    reassignSource,
    restoreMoveOrigin,
    completeMoveCreate,
    clearPendingMove,
    holdMove,
    releaseMove,
    isMoveHeld,
    addTask,
    planTask,
    planTasks,
    setSourceNotPlanned,
    unplanTask,
    unplanTasks,
    removeTask,
    replaceTasksWith,
    updateTaskTimespent,
    addTrackedSeconds,
    setTimeSpent,
    beginAfterMidnight,
    clearAfterMidnight,
    settleAfterMidnight,
    takeAfterMidnight,
    takeOffSeconds,
    setCompletedAt,
    clearPendingTimeUpdate,
    clearAllPendingTimeUpdates,
    setTasks,
    adoptAsLocal,
    beginSourceSwitch,
    unsyncedOf,
    disconnectSource,
    mergeTasks,
    setLoading,
    setLastSyncTimestamp,
    updateLastSyncTimestamp,
    archiveTasks,
    unarchiveTasks,
    undeleteTask,
    guardRestoredTask,
    markPendingUpdateSyncing,
    markPendingUpdateFailed,
    cleanupStalePendingUpdates,
    rebuildCustomPropertyIndex,
    getTasksWithCustomValue,
    clearCustomPropertyIndexes,
    incrementTaskOperationVersion,
    getTaskOperationVersion,
    lockTaskStatus,
    unlockTaskStatus,
    batchUpdateTaskStatus,
    recordCarryOver,
    pruneCarryOver,
    takeBackCarryOver,
    setCarryOver,
    keepCarryOver,
    restoreCarryOver,
    renameValue,
    addPendingDelete,
    removePendingDelete,
    markPendingDeleteQueued,
    setPendingDeleteSlot,
  };
}, {
  persist: {
    key: 'tasks-store',
    afterHydrate: (ctx: { store: { tasks: Task[]; pendingDeletes?: Record<string, PendingTaskDelete>; lastSyncTimestamp?: Date | null; pendingTimeUpdates?: Record<string, PendingTimeUpdate>; $persist: () => void } }) => {
      // Storage holds ISO strings; the types say Date (#376). Reviving is not a stored-shape change, so it
      // stays out of `changed` below and never writes by itself (#273). It runs on every hydrate, also
      // when no task came back: the sync time and the pending time updates live outside the tasks.
      const reviveRest = () => {
        const lastSync = reviveDate(ctx.store.lastSyncTimestamp);
        if (lastSync !== ctx.store.lastSyncTimestamp) ctx.store.lastSyncTimestamp = lastSync;
        const timeUpdates = revivePendingTimeUpdates(ctx.store.pendingTimeUpdates ?? {});
        if (timeUpdates !== (ctx.store.pendingTimeUpdates ?? {})) ctx.store.pendingTimeUpdates = timeUpdates;
      };

      const restoredTasks = ctx.store.tasks;
      // Nothing restored (no tasks-store key): reconciling with [] would wipe the persisted board order.
      if (!restoredTasks?.length && !Object.keys(ctx.store.pendingDeletes ?? {}).length) {
        reviveRest();
        return;
      }
      const boardStore = useBoardStore();

      // Tasks saved before sources existed belong to the board's only source of that time (D2). The
      // board store hydrated first (it was just created above), so its sources are already mapped.
      const fallback = legacyTaskSource(boardStore.boardConfig.sources);
      const normalizedTasks = normalizeTasks(restoredTasks ?? [], fallback);
      const normalizedDeletes = normalizePendingDeletes(ctx.store.pendingDeletes ?? {}, fallback);
      const changed = normalizedTasks !== (restoredTasks ?? []) || normalizedDeletes !== (ctx.store.pendingDeletes ?? {});
      const tasks = reviveTaskDates(normalizedTasks);
      const pendingDeletes = revivePendingDeletes(normalizedDeletes);
      if (tasks !== (restoredTasks ?? [])) ctx.store.tasks = tasks;
      if (pendingDeletes !== (ctx.store.pendingDeletes ?? {})) ctx.store.pendingDeletes = pendingDeletes;
      reviveRest();

      if (tasks.length) {
        const propertyOptionsStore = usePropertyOptionsStore();
        boardStore.reconcileColumnsWithTasks(tasks);
        propertyOptionsStore.extractOptionsFromTasks(tasks);
      }

      // Hydration must not write on its own (#273): persist only when normalising changed something.
      if (!changed) return;
      try {
        ctx.store.$persist();
      } catch {
        // Storage unavailable - the normalised value is persisted on the next mutation instead.
      }
    },
    // No custom serializer needed!
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTasksStore, import.meta.hot));
}
