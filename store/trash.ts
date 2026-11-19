import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import type { TrashEntry } from '~/types/trash'
import { TRASH_SHEET_LIMIT, pruneTrash } from '~/lib/trash'
import { reviveTaskDates } from '~/lib/taskDates'
import { renameField, type NameKind } from '~/lib/topicNames'
import { normalizeCreateUncertain } from '~/lib/taskSources'

/**
 * The trash of deleted tasks (#422, D3): snapshots of what the user deleted, newest first, kept 30 days and at
 * most 100. Persisted under `trash-store` through `appStorage` (export/import and the desktop data file carry
 * it). A state without the key hydrates to an empty trash; hydration writes only when it purged (#273).
 *
 * Only the snapshots live here. Whether the source still holds the task is the source's business: restoring
 * goes through `useTrash` / `useTaskSync.restoreTask`. Disconnecting a source leaves its entries in place (a
 * restore then reports the source as not connected).
 */
export const useTrashStore = defineStore('trash', () => {
  const entries = ref<TrashEntry[]>([])

  const count = computed(() => entries.value.length)
  /** The entries the trash sheet shows. */
  const recent = computed(() => entries.value.slice(0, TRASH_SHEET_LIMIT))

  function entry(taskId: string): TrashEntry | undefined {
    return entries.value.find(item => item.taskId === taskId)
  }

  /** Puts an entry on top. An entry of the same task is replaced (a re-delete after a restore). */
  function add(item: TrashEntry, now: number = Date.now()): void {
    entries.value = pruneTrash([item, ...entries.value.filter(existing => existing.taskId !== item.taskId)], now)
  }

  /**
   * A restore of the task created a page and ended with an unknown outcome (#535): the entry keeps the doubt (the earliest
   * attempt stays, the latest one and the title of the last one are kept; the same rule as `tasksStore.markCreateUncertain`),
   * so the next restore looks for the page before it creates one.
   */
  function markCreateUncertain(taskId: string, attemptedAt: number, title: string): void {
    const held = entry(taskId)
    if (!held) return
    const doubt = held.createUncertain
    const next = { since: Math.min(attemptedAt, doubt?.since ?? attemptedAt), at: Math.max(attemptedAt, doubt?.at ?? doubt?.since ?? attemptedAt), title }
    entries.value = entries.value.map(item => item.taskId === taskId ? { ...item, createUncertain: next } : item)
  }

  /**
   * A fetch returned the page a restore's doubtful create made (#545, `tasksStore.adoptLandedPages`): the entry takes it as
   * its page (`task.externalId`) and drops the doubt, so the next restore un-archives that page instead of creating one.
   * @returns the entry as it is now, undefined when it is gone or holds no doubt
   */
  function takeLandedPage(taskId: string, pageId: string): TrashEntry | undefined {
    const held = entry(taskId)
    if (!held?.createUncertain) return undefined
    const { createUncertain: _doubt, ...rest } = held
    const taken: TrashEntry = { ...rest, task: { ...held.task, externalId: pageId } }
    entries.value = entries.value.map(item => item.taskId === taskId ? taken : item)
    return taken
  }

  function remove(taskId: string): void {
    if (entry(taskId)) entries.value = entries.value.filter(item => item.taskId !== taskId)
  }

  function clear(): void {
    if (entries.value.length > 0) entries.value = []
  }

  /** Drops expired and surplus entries; returns whether anything changed. */
  function purge(now: number = Date.now()): boolean {
    const pruned = pruneTrash(entries.value, now)
    if (pruned === entries.value) return false
    entries.value = pruned
    return true
  }

  /** Rewrites a topic or activity name on the snapshots (#430): a restored task carries the new name. */
  function renameValue(kind: NameKind, from: string, to: string): number {
    let changed = 0
    const next = entries.value.map((item) => {
      const task = renameField(item.task, kind, from, to)
      if (task === item.task) return item
      changed += 1
      return { ...item, task }
    })
    if (changed > 0) entries.value = next
    return changed
  }

  return { entries, count, recent, entry, add, markCreateUncertain, takeLandedPage, remove, clear, purge, renameValue }
}, {
  persist: {
    key: 'trash-store',
    pick: ['entries'],
    afterHydrate: (ctx: { store: { entries: TrashEntry[]; purge: () => boolean; $persist: () => void } }) => {
      const stored = Array.isArray(ctx.store.entries) ? ctx.store.entries : []
      // Storage holds ISO strings for the snapshot's dates (#376); reviving is not a stored-shape change.
      // A hand-edited or imported entry without a task is dropped, not dereferenced
      const valid = stored.filter(item => item?.task)
      const revived = valid.map((item) => {
        const [task] = reviveTaskDates([item.task])
        // #535: a malformed doubt reads as none (it only costs the lookup before the next create); a valid one is kept as it is
        const { createUncertain: doubt, ...rest } = item
        const keptDoubt = doubt === undefined ? undefined : normalizeCreateUncertain(doubt)
        if (doubt !== undefined && keptDoubt === undefined) return { ...rest, task: task! }
        return task === item.task ? item : { ...item, task: task! }
      })
      ctx.store.entries = revived.some((item, index) => item !== valid[index]) || valid.length !== stored.length ? revived : stored
      // Hydration must not write on its own (#273): persist only when the purge changed something.
      if (!ctx.store.purge()) return
      try {
        ctx.store.$persist()
      } catch {
        // Storage unavailable - the purged value is persisted on the next mutation instead.
      }
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTrashStore, import.meta.hot))
}
