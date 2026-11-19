/**
 * @module lib/remindersEvents
 * @description A write that Reminders answered with `changed` (the stored state moved on since the last fetch: a
 * recurring reminder was ticked elsewhere) is no failure, but what kan-do holds is stale (#551). `RemindersSource` raises
 * this event; the tasks page listens and runs one quiet refetch (no toast, no health change). A module of its own, like
 * `lib/taskMoveEvents`: the adapter sits below the composables that can fetch.
 */
type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribes to "the source changed under a write"; returns the unsubscribe function. */
export function onRemindersChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyRemindersChanged(): void {
  for (const listener of listeners) listener()
}
