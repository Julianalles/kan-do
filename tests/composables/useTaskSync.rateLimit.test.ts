/**
 * #529: a 429 limits the whole source, not the task that met it. The push loops stop for the source until the window
 * (`Retry-After`, else `RATE_LIMIT_WINDOW_MS`) has passed; the tasks keep their marker and their order, the source is
 * never marked as failing, and another source is not held back.
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

const todoistClosed: string[] = []
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function () {
    return { closeTask: async (id: string) => { todoistClosed.push(id); return true } }
  }),
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
import { useTaskSync, RATE_LIMIT_WINDOW_MS } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const limited = (retryAfterMs: number | null = null) =>
  Object.assign(new Error('Too Many Requests'), { statusCode: 429, retryAfterMs })

const pendingNotion = (id: string, input: Partial<Task> = {}): Task => ({
  id, source: 'notion', externalId: id, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
  topicColorCode: 'blue', priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  pendingSync: { since: 1, attempts: 0, lastError: null },
  ...input,
})

const sentIds = () => notion.updateTask.mock.calls.map(([task]) => task.id)

describe('a 429 pauses the pushes of its source (#529)', () => {
  let now = 1_700_000_000_000

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.updateTask.mockImplementation(async (task) => ({ ...task }))
    notion.createTask.mockImplementation(async (input) => ({ ...pendingNotion('page-new'), ...input, id: 'page-new', externalId: 'page-new' } as Task))
    notion.findLandedPage.mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    now = 1_700_000_000_000
    todoistClosed.length = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([pendingNotion('a'), pendingNotion('b'), pendingNotion('c')])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('the first 429 stops the loop: the other tasks are not sent, keep their marker and the source stays healthy', async () => {
    const tasksStore = useTasksStore()
    notion.updateTask.mockRejectedValueOnce(limited())
    await useTaskSync().syncPendingChanges('notion')

    expect(sentIds()).toEqual(['a'])
    for (const id of ['a', 'b', 'c']) expect(tasksStore.task(id)?.pendingSync).toBeDefined()
    expect(useIntegrationHealthStore().needsAttention('notion')).toBe(false)
    expect(useIntegrationHealthStore().healthOf('notion').status).not.toBe('broken')
  })

  it('sends nothing more until the window has passed, then resumes in the original order, none lost or sent twice', async () => {
    const tasksStore = useTasksStore()
    notion.updateTask.mockRejectedValueOnce(limited(30_000))
    await useTaskSync().syncPendingChanges('notion')
    notion.updateTask.mockClear()

    now += 29_000
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.updateTask).not.toHaveBeenCalled() // still inside the window the 429 named

    now += 2_000
    await useTaskSync().syncPendingChanges('notion')
    expect(sentIds()).toEqual(['a', 'b', 'c'])
    for (const id of ['a', 'b', 'c']) expect(tasksStore.task(id)?.pendingSync).toBeUndefined()
  })

  it('a 429 without Retry-After pauses for the default window', async () => {
    notion.updateTask.mockRejectedValueOnce(limited(null))
    await useTaskSync().syncPendingChanges('notion')
    notion.updateTask.mockClear()

    now += RATE_LIMIT_WINDOW_MS - 1
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.updateTask).not.toHaveBeenCalled()
    now += 2
    await useTaskSync().syncPendingChanges('notion')
    expect(sentIds()).toEqual(['a', 'b', 'c'])
  })

  it('a task that fails for its own reason (404, 500) does not stop the others', async () => {
    const error = Object.assign(new Error('Not found'), { statusCode: 404 })
    notion.updateTask.mockRejectedValueOnce(error)
    await useTaskSync().syncPendingChanges('notion')
    expect(sentIds()).toEqual(['a', 'b', 'c'])
  })

  it('a 429 wrapped in another error (cause chain) counts as well', async () => {
    notion.updateTask.mockRejectedValueOnce(new Error('Could not write', { cause: limited() }))
    await useTaskSync().syncPendingChanges('notion')
    expect(sentIds()).toEqual(['a'])
  })

  it('does not hold back another source', async () => {
    const tasksStore = useTasksStore()
    useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'notion' })
    useBoardStore().boardConfig.todoistApiToken = 'token'
    tasksStore.setTasks([
      pendingNotion('a'),
      pendingNotion('b'),
      pendingNotion('t1', { source: 'todoist', status: TaskStatus.Done }),
    ])
    notion.updateTask.mockRejectedValueOnce(limited())
    await useTaskSync().syncPendingChanges()
    expect(sentIds()).toEqual(['a']) // Notion stopped at the 429
    expect(todoistClosed).toEqual(['t1']) // Todoist was pushed all the same
  })

  it('a create from a task made offline is not sent inside the window and is created after it', async () => {
    const tasksStore = useTasksStore()
    tasksStore.setTasks([
      pendingNotion('local_1', { externalId: null, title: 'Neu 1' }),
      pendingNotion('local_2', { externalId: null, title: 'Neu 2' }),
    ])
    notion.createTask.mockRejectedValueOnce(limited(20_000))
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task('local_1')?.pendingSync?.createUncertain).toBeUndefined() // a 429 refused it: no doubt

    now += 21_000
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(3) // the first again, then the second
    expect(notion.findLandedPage).not.toHaveBeenCalled()
  })

  it('a task added while the source is limited is queued without a request, and sent after the window', async () => {
    const tasksStore = useTasksStore()
    notion.updateTask.mockRejectedValueOnce(limited(30_000))
    await useTaskSync().syncPendingChanges('notion')

    const added = await useTaskSync().createTask({ title: 'Mitten im Limit', status: TaskStatus.Open, priority: 1 }, 'notion')
    expect(notion.createTask).not.toHaveBeenCalled()
    expect(tasksStore.task(added.id)).toMatchObject({ externalId: null })
    expect(tasksStore.task(added.id)?.pendingSync).toBeDefined()

    now += 31_000
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(added.id)?.pendingSync).toBeUndefined()
  })

  it('a push that goes through lifts the pause', async () => {
    notion.updateTask.mockRejectedValueOnce(limited(30_000))
    await useTaskSync().syncPendingChanges('notion')
    notion.updateTask.mockClear()
    now += 31_000
    await useTaskSync().syncPendingChanges('notion')
    notion.updateTask.mockClear()
    useTasksStore().markPendingSync('a')
    await useTaskSync().syncPendingChanges('notion')
    expect(sentIds()).toEqual(['a'])
  })
})
