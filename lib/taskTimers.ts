/**
 * @module lib/taskTimers
 * @description Registry of the running task timers (#352): one `setInterval` per task in Jetzt, owned by
 * the app-level driver (`composables/useTaskTimerDriver`). The only place that calls `setInterval` /
 * `clearInterval` for task timers, so a `clearInterval` only ever sees a handle made here in this page
 * load. Plain TypeScript, imports no store; the registry is runtime state and is never persisted.
 */

/** A task timer ticks once a second; each tick adds one second of tracked time. */
export const TASK_TIMER_TICK_MS = 1000

const timers = new Map<string, number>()

/** Tasks whose move into Jetzt right now is a resume of a pause (#405), not a fresh entry. Runtime only. */
const resumeEntries = new Set<string>()

/**
 * Runs `move` (the status change that puts a paused task back in Jetzt) with the task marked as resuming: the driver's
 * watcher keeps what the task had before the pause (the after-midnight note, #356) instead of treating the entry as
 * the user's fresh one. The marker is set only for the duration of `move`, so a later entry is a fresh one again.
 */
export function withResumeEntry<T>(taskId: string, move: () => T): T {
  resumeEntries.add(taskId)
  try {
    return move()
  } finally {
    resumeEntries.delete(taskId)
  }
}

export function isResumeEntry(taskId: string): boolean {
  return resumeEntries.has(taskId)
}

/**
 * Starts the timer of a task, replacing a timer the registry already holds for it (never two per task).
 * @returns the interval handle, to be shown as `task.timerId`
 */
export function armTaskTimer(taskId: string, tick: () => void): number {
  disarmTaskTimer(taskId)
  const handle = window.setInterval(tick, TASK_TIMER_TICK_MS)
  timers.set(taskId, handle)
  return handle
}

/** Clears the registry's timer of a task. @returns whether there was one */
export function disarmTaskTimer(taskId: string): boolean {
  const handle = timers.get(taskId)
  if (handle === undefined) return false
  window.clearInterval(handle)
  timers.delete(taskId)
  return true
}

export function isTaskTimerArmed(taskId: string): boolean {
  return timers.has(taskId)
}

export function armedTaskTimerIds(): string[] {
  return [...timers.keys()]
}

export function disarmAllTaskTimers(): void {
  for (const taskId of [...timers.keys()]) disarmTaskTimer(taskId)
}

// A Vite HMR re-run replaces this module with an empty registry: clear the old one first, or its intervals leak
if (import.meta.hot) {
  import.meta.hot.dispose(disarmAllTaskTimers)
}
