/**
 * @store remindersConfig
 * @description What kan-do keeps of the Apple Reminders source (#551, epic #481 decision E3): the answer per list
 * (Thema, Aktivität, Aus) and the ledger of recurring occurrences done today. Its own persisted key, not a field of
 * `boardConfig` (ADR 015 addendum "Reminders source"). Additive and tolerant like `notionConfig`: nothing stored means no
 * lists; a malformed role or ledger entry reads as its default in memory (`afterHydrate`, no write, #273). No secret:
 * macOS holds the permission, nothing here is a token.
 */
import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import type { RemindersAccessStatus } from '~/lib/reminders'
import {
  DEFAULT_LIST_ROLE,
  readLedger,
  readLists,
  startOfLocalDay,
  type DoneOccurrence,
  type ReminderListConfig,
  type ReminderListRole,
} from '~/lib/remindersSource'

export const useRemindersConfigStore = defineStore('remindersConfig', () => {
  /** The user's answer per list (slice 3 writes it); a list that is not here reads as `topic`. */
  const lists = ref<Record<string, ReminderListConfig>>({})
  /** Recurring occurrences done today, by `externalId`: kept as Done cards until local midnight. */
  const doneOccurrences = ref<Record<string, DoneOccurrence>>({})
  /** The permission as the last native call saw it. Runtime only: the first fetch of a session asks again. */
  const accessStatus = ref<RemindersAccessStatus | null>(null)

  const roleOf = (listId: string): ReminderListRole => lists.value[listId]?.role ?? DEFAULT_LIST_ROLE

  function setList(listId: string, config: ReminderListConfig) {
    lists.value = { ...lists.value, [listId]: { role: config.role, title: config.title } }
  }

  function setAccessStatus(status: RemindersAccessStatus | null) {
    accessStatus.value = status
  }

  function recordDoneOccurrence(externalId: string, completedAt: number) {
    doneOccurrences.value = { ...doneOccurrences.value, [externalId]: { completedAt } }
  }

  function dropDoneOccurrence(externalId: string) {
    if (!(externalId in doneOccurrences.value)) return
    const { [externalId]: _dropped, ...rest } = doneOccurrences.value
    doneOccurrences.value = rest
  }

  /** Drops what was completed before today (local midnight): the next day's fetch no longer needs it. */
  function pruneDoneOccurrences(now: number = Date.now()) {
    const dayStart = startOfLocalDay(now)
    const kept = Object.entries(doneOccurrences.value).filter(([, entry]) => entry.completedAt >= dayStart)
    if (kept.length !== Object.keys(doneOccurrences.value).length) doneOccurrences.value = Object.fromEntries(kept)
  }

  return {
    lists,
    doneOccurrences,
    accessStatus,
    roleOf,
    setList,
    setAccessStatus,
    recordDoneOccurrence,
    dropDoneOccurrence,
    pruneDoneOccurrences,
  }
}, {
  persist: {
    // The permission is macOS's and relearned by the next call: only the user's answers and the ledger are stored
    pick: ['lists', 'doneOccurrences'],
    // A malformed role or ledger entry reads as its default in memory; nothing is written here (#273)
    afterHydrate: (ctx: { store: { lists: unknown; doneOccurrences: unknown } }) => {
      const { store } = ctx
      store.lists = readLists(store.lists)
      store.doneOccurrences = readLedger(store.doneOccurrences)
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRemindersConfigStore, import.meta.hot))
}
