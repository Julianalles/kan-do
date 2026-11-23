/**
 * #758: the in-card flow stores its task when the title is confirmed and writes every later answer through
 * `useTaskSync().editTask`. Sequences on a Notion board: the create's `onAdd` runs before the board can render the
 * task, an edit is pushed after a push still in flight, and a fetch that was read before the edit keeps it.
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
  timeSpentSeconds: 0, timerId: null,
})

describe('useTaskSync.editTask (#758)', () => {
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

  it('createTask hands the task to onAdd before it enters the store, in the same tick', async () => {
    const tasksStore = useTasksStore()
    const seen: Array<{ id: string; inStore: boolean }> = []
    const created = await useTaskSync().createTask(draft(), 'notion', {
      onAdd: (task) => seen.push({ id: task.id, inStore: tasksStore.task(task.id) !== null }),
    })
    expect(seen).toEqual([{ id: created.id, inStore: false }])
    expect(tasksStore.task(created.id)).not.toBeNull()
  })

  it('writes the edit to the store at once and pushes it; the marker clears once Notion holds it', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: null }), 'notion')
    const pushed = sync.editTask(created.id, { timeBoxSeconds: 1800 })
    expect(tasksStore.task(created.id)?.timeBoxSeconds).toBe(1800)
    expect(await pushed).toBe(true)
    expect(notion.updateTask).toHaveBeenCalledTimes(1)
    expect(notion.updateTask.mock.calls[0]![0]).toMatchObject({ id: created.id, externalId: 'page-new', timeBoxSeconds: 1800 })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
  })

  it('an answer given while the previous one is still being pushed goes out after it, with both answers', async () => {
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ topic: null, timeBoxSeconds: null }), 'notion')
    let release!: () => void
    notion.updateTask.mockImplementationOnce(async (task) => {
      await new Promise<void>((resolve) => { release = resolve })
      return task
    })
    const first = sync.editTask(created.id, { topic: 'Büro' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = sync.editTask(created.id, { timeBoxSeconds: 900 })
    await Promise.resolve()
    expect(notion.updateTask).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(notion.updateTask).toHaveBeenCalledTimes(2)
    expect(notion.updateTask.mock.calls[1]![0]).toMatchObject({ topic: 'Büro', timeBoxSeconds: 900 })
  })

  it('a fetch read before the edit and merged after it keeps the edit (the task was written since the fetch began)', async () => {
    const tasksStore = useTasksStore()
    const sync = useTaskSync()
    const created = await sync.createTask(draft({ timeBoxSeconds: null }), 'notion')
    const fetchStartedAt = Date.now() - 1000
    let release!: () => void
    notion.updateTask.mockImplementationOnce(async (task) => {
      await new Promise<void>((resolve) => { release = resolve })
      return task
    })
    const pushed = sync.editTask(created.id, { timeBoxSeconds: 1800 })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    // Notion still answers with the page as the create left it
    tasksStore.mergeTasks('notion', [notionPage('page-new', draft({ timeBoxSeconds: null }))], { fetchStartedAt, pushing: sync.isPushing })
    expect(tasksStore.task(created.id)?.timeBoxSeconds).toBe(1800)
    release()
    await pushed
    // and once the push is done, a fetch read before the edit still cannot take it back
    tasksStore.mergeTasks('notion', [notionPage('page-new', draft({ timeBoxSeconds: null }))], { fetchStartedAt, pushing: sync.isPushing })
    expect(tasksStore.task(created.id)?.timeBoxSeconds).toBe(1800)
    expect(tasksStore.tasks).toHaveLength(1)
  })

  it('an unknown task is not edited', async () => {
    expect(await useTaskSync().editTask('nope', { title: 'x' })).toBe(false)
    expect(notion.updateTask).not.toHaveBeenCalled()
  })
})
