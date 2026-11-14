/**
 * #313: seconds a timer checkpoint writes (`addTrackedSeconds`) while a push of the task is in flight are not
 * lost: the source's echo of that push holds the older total and must not lower the local one, and the push must
 * not drop the queued entry of the newer total. Both sequences are covered: a checkpoint during the push, and none.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(),
  }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task, change?: { timeEdited?: boolean }) => Promise<Task>>(),
  createTask: vi.fn<(task: Task) => Promise<Task>>(),
}
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null } } }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { mapHelpers } from '~/utils/mapHelpers'
/* eslint-enable import/first */

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, source: 'notion', externalId: `page-${id}`, title: `Task ${id}`, status: TaskStatus.Progress, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

describe('a checkpoint during a push survives the echo (#313)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    Object.values(notion).forEach((fn) => fn.mockReset())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([task('n1', { timeSpentSeconds: 100 })])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('with a checkpoint during the push: the echo does not lower the total and the next flush sends it', async () => {
    const store = useTasksStore()
    let landFirst!: (t: Task) => void
    notion.updateTask.mockImplementationOnce(() => new Promise<Task>((resolve) => { landFirst = resolve }))
    store.addTrackedSeconds('n1', 5) // the checkpoint that started this push's total: 105
    const push = useTaskSync().syncTaskToIntegration(store.task('n1')!)

    store.addTrackedSeconds('n1', 10) // the next checkpoint lands while the write is in flight: 115
    landFirst({ ...store.task('n1')!, timeSpentSeconds: 105 }) // the source echoes what the push carried
    await push

    expect(store.task('n1')?.timeSpentSeconds).toBe(115)
    expect(store.pendingTimeUpdates['n1']?.timeSpentSeconds).toBe(115)
    expect(store.task('n1')?.pendingSync).toBeDefined()

    notion.updateTask.mockImplementation(async (t) => ({ ...t })) // the source now holds what is written
    await useTaskSync().syncPendingChanges()

    expect(notion.updateTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'n1', timeSpentSeconds: 115 }))
    expect(store.task('n1')?.timeSpentSeconds).toBe(115)
    expect(mapHelpers.has(store.pendingTimeUpdates, 'n1')).toBe(false)
    expect(store.task('n1')?.pendingSync).toBeUndefined()
  })

  it('a checkpoint during the push of a task that was created offline is kept the same way', async () => {
    const store = useTasksStore()
    store.setTasks([task('n1', { externalId: null, timeSpentSeconds: 100 })])
    let landCreate!: (t: Task) => void
    notion.createTask.mockImplementationOnce(() => new Promise<Task>((resolve) => { landCreate = resolve }))
    store.addTrackedSeconds('n1', 5)
    const push = useTaskSync().syncTaskToIntegration(store.task('n1')!)

    store.addTrackedSeconds('n1', 10)
    landCreate({ ...store.task('n1')!, externalId: 'page-new', timeSpentSeconds: 105 })
    await push

    expect(store.task('n1')?.externalId).toBe('page-new')
    expect(store.task('n1')?.timeSpentSeconds).toBe(115)
    expect(store.pendingTimeUpdates['n1']?.timeSpentSeconds).toBe(115)
  })

  it('without a checkpoint during the push: the echo is applied and the entry and marker are cleared', async () => {
    const store = useTasksStore()
    store.addTrackedSeconds('n1', 5)
    notion.updateTask.mockImplementation(async (t) => ({ ...t, timeSpentSeconds: 110 })) // the source holds more (another device)

    await useTaskSync().syncTaskToIntegration(store.task('n1')!)

    expect(store.task('n1')?.timeSpentSeconds).toBe(110)
    expect(mapHelpers.has(store.pendingTimeUpdates, 'n1')).toBe(false)
    expect(store.task('n1')?.pendingSync).toBeUndefined()
  })

  it('a checkpoint after the push has landed queues normally and sets no extra marker', async () => {
    const store = useTasksStore()
    notion.updateTask.mockImplementation(async (t) => ({ ...t }))
    await useTaskSync().syncTaskToIntegration(store.task('n1')!)

    store.addTrackedSeconds('n1', 10)

    expect(store.task('n1')?.pendingSync).toBeUndefined()
    expect(store.pendingTimeUpdates['n1']?.timeSpentSeconds).toBe(110)
  })
})
