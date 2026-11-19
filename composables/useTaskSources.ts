/**
 * @composable useTaskSources
 * @description The task source adapter registry (#318): resolves the adapter of a source, wired to the
 * current stores and configs. Adapters are cheap and built per call, so a changed token or Notion config
 * is always picked up. `useTaskSync` and `useIntegrationManager` go through this and never switch on a
 * source name themselves.
 */
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useRemindersConfigStore } from '~/store/remindersConfig'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { useNotionIntegration } from '~/composables/useNotionIntegration'
import { useNotionDataSource } from '~/composables/useNotionDataSource'
import { LocalSource } from '~/integrations/sources/LocalSource'
import { NotionSource } from '~/integrations/sources/NotionSource'
import { TodoistSource } from '~/integrations/sources/TodoistSource'
import { RemindersSource } from '~/integrations/sources/RemindersSource'
import type { TaskSourceAdapter } from '~/integrations/sources/types'
import type { SourceId } from '~/types/taskSource'
import { syncToday, useToday } from '~/composables/useToday'
import { dayHasBegun } from '~/lib/dayBegun'
import { dayKey } from '~/utils/recapDay'

export const useTaskSources = () => {
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()
  const notionConfig = useNotionConfigStore()
  const health = useIntegrationHealthStore()
  const remindersConfig = useRemindersConfigStore()

  const adapterFor = (source: SourceId): TaskSourceAdapter => {
    switch (source) {
      case 'local':
        return new LocalSource(() => tasksStore.tasks.filter((task) => task.source === 'local'))
      case 'notion':
        return new NotionSource({
          isConfigured: () => useNotionIntegration().isConfigured.value,
          ensureDataSource: async () => {
            if (notionConfig.hasDataSourceSelected) return true
            return await useNotionDataSource().ensureDataSourceConfigured()
          },
          createInstance: () => useNotionIntegration().createInstance(),
          archiveStatus: () => notionConfig.config?.statusMapping?.archive || null,
          notPlannedStatus: () => {
            // Stored data: anything but a list of names reads as "none mapped"
            const mapped: unknown = notionConfig.config?.statusMapping?.notPlanned
            return Array.isArray(mapped) ? mapped.find((name): name is string => typeof name === 'string' && name !== '') ?? null : null
          },
          onNotPlannedLimit: (limited) => notionConfig.setNotPlannedLimited(limited),
          health: () => health.statusOf('notion'),
        })
      case 'todoist':
        return new TodoistSource({
          apiToken: () => boardStore.boardConfig.todoistApiToken,
          health: () => health.statusOf('todoist'),
        })
      case 'reminders':
        return new RemindersSource({
          roleOf: (listId) => remindersConfig.roleOf(listId),
          heldTasks: () => tasksStore.tasks.filter((task) => task.source === 'reminders'),
          accessStatus: () => remindersConfig.accessStatus,
          setAccessStatus: (status) => remindersConfig.setAccessStatus(status),
          ledger: () => remindersConfig.doneOccurrences,
          recordDone: (externalId, completedAt) => remindersConfig.recordDoneOccurrence(externalId, completedAt),
          dropDone: (externalId) => remindersConfig.dropDoneOccurrence(externalId),
          pruneLedger: (now) => remindersConfig.pruneDoneOccurrences(now),
          health: () => health.statusOf('reminders'),
          // The local date as the string a reminder's date is compared with, never `Date()` inline
          today: () => {
            syncToday()
            return dayKey(useToday().today.value)
          },
          dayHasBegun: () => dayHasBegun(),
        })
    }
  }

  return { adapterFor } as const
}
