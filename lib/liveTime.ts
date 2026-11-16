/**
 * @module lib/liveTime
 * @description The running seconds of a timed task (#286). A task in Jetzt gains a second every second, but the
 * tasks store is serialised, persisted and watched as a whole, so a store write per second costs more the more
 * tasks are stored. The seconds therefore collect here, in runtime-only reactive state, and the timer driver writes
 * them into the store every `LIVE_CHECKPOINT_SECONDS` and wherever the stored value is read or the page may go away.
 * What the user sees (card chip, sheet, capacity) is `liveTimeSpent(task)`: stored time plus these seconds.
 * Plain TypeScript, imports no store; never persisted, never part of a store's state.
 */
import { reactive } from 'vue'
import { mapHelpers } from '~/utils/mapHelpers'

/** Seconds a timer collects before the driver writes them into the store; also the most a hard crash can lose. */
export const LIVE_CHECKPOINT_SECONDS = 10

/** Unsaved seconds per task id. Exported for the reactivity check in tests only. */
export const liveSecondsState = reactive<Record<string, number>>({})

/** Of the unsaved seconds, those counted while the user was away from the app window (#356). Never more than `liveSecondsState`. */
export const liveAwaySecondsState = reactive<Record<string, number>>({})

/**
 * The wall-clock spans (`[from, to]`, epoch ms) in which those away seconds were counted, runtime only like the
 * seconds. Consecutive away ticks extend one span (a throttled tab ticks rarely, the span still runs through); a tick
 * with the user in the window closes it. They go to the store with the seconds, so the user's "Zeit abziehen" after a new day can take
 * the same stretch out of the work sessions (#356, D3 h).
 */
const awaySpans = new Map<string, { spans: Array<[number, number]>; open: boolean }>()

/**
 * Adds one second to a task and returns the seconds collected for it now. `away`: the user was away from the window
 * when it was counted (`lib/appPresence`); only such seconds are offered to be taken off again after a new day (#356). `now` is the
 * tick's time.
 */
export function addLiveSecond(taskId: string, away = false, now: number = Date.now()): number {
  const next = (liveSecondsState[taskId] ?? 0) + 1
  liveSecondsState[taskId] = next
  const state = awaySpans.get(taskId)
  if (away) {
    liveAwaySecondsState[taskId] = (liveAwaySecondsState[taskId] ?? 0) + 1
    if (state?.open && state.spans.length > 0) state.spans[state.spans.length - 1]![1] = now
    else awaySpans.set(taskId, { spans: [...(state?.spans ?? []), [now - 1000, now]], open: true })
  } else if (state) {
    state.open = false
  }
  return next
}

/** The collected away spans of a task (a copy; empty spans left out). */
export function liveAwaySpansOf(taskId: string): Array<[number, number]> {
  return (awaySpans.get(taskId)?.spans ?? []).filter(([from, to]) => to > from).map(([from, to]) => [from, to])
}

/** The collected spans reached the store: an open one goes on from where it ended (no hole between two checkpoints), the rest are done. */
export function settleLiveAwaySpans(taskId: string): void {
  const state = awaySpans.get(taskId)
  const last = state?.spans.at(-1)
  if (state && state.open && last) state.spans = [[last[1], last[1]]]
  else awaySpans.delete(taskId)
}

/** The timer of a task stopped: its spans end with it. */
export function forgetLiveAwaySpans(taskId: string): void {
  awaySpans.delete(taskId)
}

/** The collected seconds of a task that were counted while the user was away. */
export function liveAwaySecondsOf(taskId: string): number {
  return liveAwaySecondsState[taskId] ?? 0
}

/** The seconds collected for a task and not yet written to the store. */
export function liveSecondsOf(taskId: string): number {
  return liveSecondsState[taskId] ?? 0
}

/** Stored time plus the collected seconds: the time to show. */
export function liveTimeSpent(task: { id: string; timeSpentSeconds?: number | null }): number {
  return (task.timeSpentSeconds ?? 0) + liveSecondsOf(task.id)
}

/** Returns the collected seconds of a task and clears them. */
export function takeLiveSeconds(taskId: string): number {
  const seconds = liveSecondsState[taskId] ?? 0
  mapHelpers.delete(liveSecondsState, taskId)
  mapHelpers.delete(liveAwaySecondsState, taskId)
  return seconds
}

/** Drops the collected seconds of a task without writing them (a total the user set, a task that is gone). */
export function discardLiveSeconds(taskId: string): void {
  mapHelpers.delete(liveSecondsState, taskId)
  mapHelpers.delete(liveAwaySecondsState, taskId)
}

export function unsavedLiveSecondsIds(): string[] {
  return Object.keys(liveSecondsState).filter((id) => liveSecondsState[id]! > 0)
}

export function clearAllLiveSeconds(): void {
  for (const id of Object.keys(liveSecondsState)) mapHelpers.delete(liveSecondsState, id)
  for (const id of Object.keys(liveAwaySecondsState)) mapHelpers.delete(liveAwaySecondsState, id)
  awaySpans.clear()
}

// A Vite HMR re-run replaces this module with an empty overlay: the old seconds would be lost silently, so the
// driver (which flushes on `stop()`) runs first; here only the state of the replaced module is dropped
if (import.meta.hot) {
  import.meta.hot.dispose(clearAllLiveSeconds)
}
