/**
 * @module boardSettled
 * @description Whether the board's first load of this app session has ended (#853). The welcome note and the board's
 * empty states wait for it on a board with a connection, so a connection's tasks are never announced as missing while
 * their first fetch still runs. The page's first fetch starts in `onMounted`, after the first render, so the task
 * store's `isLoading` alone would let them flash.
 *
 * Set by `useIntegrationManager().fetchTasks` when it ends (success or failure), and by the board page when it skips
 * the fetch (a token that cannot be read). Runtime only, never stored; a board without a connection does not need it.
 */
import { ref } from 'vue'

const ended = ref(false)

/** The first fetch of the session has ended, or was skipped. */
export const firstFetchEnded = () => ended.value

export function markFirstFetchEnded(): void {
  ended.value = true
}

/** The board's first load is over: at once on a board without a connection (`connected` = how many it has), else when the first fetch ended. */
export const boardSettled = (connected: number): boolean => connected === 0 || ended.value

/** Tests only. */
export function resetFirstFetchEnded(): void {
  ended.value = false
}
