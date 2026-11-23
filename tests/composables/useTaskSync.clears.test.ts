/**
 * #780: the user's "Timebox entfernen" and "Als geplant markieren" travel with the task's push as `pendingSync.clears`:
 * set by `editTask` on a real clear, kept through a refused push and a fetch, dropped when the field is set again or a
 * push carried it. No other push carries a clear.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
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
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  createTask: vi.fn<(draft: Partial<Task>) => Promise<Task>>(),
  findLandedPage: vi.fn<(title: string, since: number, claimed?: ReadonlySet<string>) => Promise<string | null>>(),
  archiveTask: vi.fn<(externalId: string) => Promise<void>>(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const draft = (overrides: Partial<Task> = {}): Partial<Task> => ({
  title: 'Rückruf', status: TaskStatus.Open, priority: 2, topic: 'Büro', timeBoxSeconds: 900, ...overrides,
})

/** What Notion answers a create with: the page id is the task's id and externalId (D1) */
const notionPage = (pageId: string, input: Partial<Task>): Task => ({
  id: pageId, source: 'notion', externalId: pageId,
  title: input.title ?? 'Untitled', status: input.status ?? TaskStatus.Open, activity: null, topic: input.topic ?? null,
  topicColorCode: 'blue', priority: input.priority ?? 1, notes: null, timeBoxSeconds: input.timeBoxSeconds ?? null,
  timeSpentSeconds: 0, timerId: null, isUnplanned: input.isUnplanned ?? false,
})

/** The `clears` the n-th update call carried (#780); undefined when it carried none */
const clearsOfCall = (n: number) => (notion.updateTask.mock.calls[n] as unknown[] | undefined)?.[1] as { clears?: string[] } | undefined

describe('useTaskSync clears (#780)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.createTask.mockImplementation(async (input) => notionPage('page-new', input))
    notion.updateTask.mockImplementation(async (task) => task)
    notion.findLandedPage.mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('removing a time box pushes its clear; the marker goes once Notion holds it', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: 900 }), 'notion')
    expect(await sync.editTask(created.id, { timeBoxSeconds: null })).toBe(true)
    expect(clearsOfCall(0)).toEqual({ clears: ['timeBox'] })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
  })

  it('"Als geplant markieren" pushes the unplanned clear', async () => {
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ isUnplanned: true }), 'notion')
    await sync.editTask(created.id, { isUnplanned: false })
    expect(clearsOfCall(0)).toEqual({ clears: ['unplanned'] })
  })

  it('regression: an edit of another field, or of a field that was empty, carries no clear', async () => {
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: null, isUnplanned: false }), 'notion')
    await sync.editTask(created.id, { priority: 3 })
    await sync.editTask(created.id, { timeBoxSeconds: null, isUnplanned: false })
    expect(notion.updateTask).toHaveBeenCalledTimes(2)
    expect(clearsOfCall(0)).toBeUndefined()
    expect(clearsOfCall(1)).toBeUndefined()
  })

  it('a refused push keeps the clear on the marker; the retry sends it and then drops it', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: 900 }), 'notion')
    notion.updateTask.mockRejectedValueOnce(Object.assign(new Error('Notion down'), { statusCode: 502 }))
    expect(await sync.editTask(created.id, { timeBoxSeconds: null })).toBe(false)
    expect(tasksStore.task(created.id)?.pendingSync?.clears).toEqual(['timeBox'])
    // the marker is persisted with the task: a restart reads it back through normalizePendingSync
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    await sync.syncPendingChanges()
    expect(notion.updateTask).toHaveBeenCalledTimes(2)
    expect(clearsOfCall(1)).toEqual({ clears: ['timeBox'] })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
  })

  it('a fetch while the clear waits keeps the task without a time box', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: 900 }), 'notion')
    notion.updateTask.mockRejectedValueOnce(Object.assign(new Error('offline'), { statusCode: 502 }))
    await sync.editTask(created.id, { timeBoxSeconds: null })
    tasksStore.mergeTasks('notion', [notionPage('page-new', draft({ timeBoxSeconds: 900 }))], { fetchStartedAt: Date.now(), pushing: sync.isPushing })
    expect(tasksStore.task(created.id)?.timeBoxSeconds).toBeNull()
    expect(tasksStore.task(created.id)?.pendingSync?.clears).toEqual(['timeBox'])
  })

  it('a time box set again before the clear was written drops the clear: the next push sends the new value only', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: 900 }), 'notion')
    notion.updateTask.mockRejectedValueOnce(Object.assign(new Error('offline'), { statusCode: 502 }))
    await sync.editTask(created.id, { timeBoxSeconds: null })
    expect(tasksStore.task(created.id)?.pendingSync?.clears).toEqual(['timeBox'])
    await sync.editTask(created.id, { timeBoxSeconds: 1800 })
    expect(clearsOfCall(1)).toBeUndefined()
    expect(notion.updateTask.mock.calls[1]![0]).toMatchObject({ timeBoxSeconds: 1800 })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
  })

  it('a change made while the clear is on its way keeps the marker but not the clear, so it is not sent twice', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: 900 }), 'notion')
    let release!: () => void
    notion.updateTask.mockImplementationOnce(async (task) => {
      await new Promise<void>((resolve) => { release = resolve })
      return task
    })
    const first = sync.editTask(created.id, { timeBoxSeconds: null })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    // a change the push does not carry: the marker stays after it
    tasksStore.markPendingSync(created.id)
    release()
    await first
    expect(tasksStore.task(created.id)?.pendingSync).toBeDefined()
    expect(tasksStore.task(created.id)?.pendingSync?.clears).toBeUndefined()
  })

  it('a clear made while an earlier push is in flight goes out with the push after it', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: 900, isUnplanned: true }), 'notion')
    let release!: () => void
    notion.updateTask.mockImplementationOnce(async (task) => {
      await new Promise<void>((resolve) => { release = resolve })
      return task
    })
    const first = sync.editTask(created.id, { priority: 3 })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = sync.editTask(created.id, { isUnplanned: false })
    release()
    await Promise.all([first, second])
    expect(clearsOfCall(0)).toBeUndefined()
    expect(clearsOfCall(1)).toEqual({ clears: ['unplanned'] })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
  })
})
