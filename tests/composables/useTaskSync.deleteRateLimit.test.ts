/**
 * #543: a delete that meets a Notion 429 waits behind the source's pause like an offline delete, instead of
 * restoring the task with an error toast. The queued delete is sent again by the periodic sync once the window has
 * passed, and a flush of several queued deletes sends one request that meets the limit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
const statistics = { recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }
vi.mock('~/store/taskStatistics', () => ({ useTaskStatisticsStore: () => statistics }))
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
import { useTaskSync, RATE_LIMIT_WINDOW_MS } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
/* eslint-enable import/first */

const limited = (retryAfterMs: number | null = null) =>
  Object.assign(new Error('Too Many Requests'), { statusCode: 429, retryAfterMs })

const notionTask = (id: string, input: Partial<Task> = {}): Task => ({
  id, source: 'notion', externalId: id, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
  topicColorCode: 'blue', priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  ...input,
})

describe('a delete that meets a 429 is queued, not undone (#543)', () => {
  let now = 1_700_000_000_000

  /** What the delete window leaves behind: the pending delete and its trash entry (the task is off the board). */
  const deleted = (id: string, state: 'waiting' | 'queued' = 'waiting', input: Partial<Task> = {}): void => {
    const task = notionTask(id, input)
    useTasksStore().addPendingDelete({ taskId: id, task, carryOver: null, state, requestedAt: now })
    useTrashStore().add({ taskId: id, task, deletedAt: now, fromStatus: TaskStatus.Open, carryOver: null })
  }

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.archiveTask.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('queues the delete: no restore, no toast, the trash entry stays, the task stays off the board', async () => {
    const tasks = useTasksStore()
    deleted('a')
    notion.archiveTask.mockRejectedValueOnce(limited())

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('queued')

    expect(tasks.pendingDeletes['a']?.state).toBe('queued')
    expect(tasks.task('a')).toBeNull()
    expect(useTrashStore().entry('a')).toBeDefined()
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a delete inside the window sends nothing and is queued', async () => {
    const tasks = useTasksStore()
    deleted('a')
    deleted('b')
    notion.archiveTask.mockRejectedValueOnce(limited(30_000))
    await useTaskSync().commitTaskDelete('a')
    notion.archiveTask.mockClear()

    now += 10_000
    await expect(useTaskSync().commitTaskDelete('b')).resolves.toBe('queued')
    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasks.pendingDeletes['b']?.state).toBe('queued')
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('the periodic sync sends the queued delete only after the window the 429 named', async () => {
    const tasks = useTasksStore()
    deleted('a')
    notion.archiveTask.mockRejectedValueOnce(limited(30_000))
    await useTaskSync().commitTaskDelete('a')
    notion.archiveTask.mockClear()

    now += 29_000
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasks.pendingDeletes['a']).toBeDefined()

    now += 2_000
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.archiveTask).toHaveBeenCalledWith('a')
    expect(tasks.pendingDeletes['a']).toBeUndefined()
    expect(useTrashStore().entry('a')).toBeDefined() // the trash keeps the snapshot: only the source's copy is gone
  })

  it('without Retry-After the pause is the default window', async () => {
    deleted('a')
    notion.archiveTask.mockRejectedValueOnce(limited(null))
    await useTaskSync().commitTaskDelete('a')
    notion.archiveTask.mockClear()

    now += RATE_LIMIT_WINDOW_MS - 1
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.archiveTask).not.toHaveBeenCalled()
    now += 2
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.archiveTask).toHaveBeenCalledTimes(1)
  })

  it('several queued deletes flushed together send one request that meets the limit', async () => {
    const tasks = useTasksStore()
    for (const id of ['a', 'b', 'c']) deleted(id, 'queued')
    notion.archiveTask.mockRejectedValueOnce(limited())

    const { commitTaskDelete } = useTaskSync()
    for (const id of ['a', 'b', 'c']) await commitTaskDelete(id)

    expect(notion.archiveTask).toHaveBeenCalledTimes(1)
    expect(Object.keys(tasks.pendingDeletes).sort()).toEqual(['a', 'b', 'c'])
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a 429 that sits in the error cause counts as well', async () => {
    deleted('a')
    notion.archiveTask.mockRejectedValueOnce(new Error('Could not archive', { cause: limited() }))
    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('queued')
  })

  it('another failure still restores the task with the toast and drops the trash entry', async () => {
    const tasks = useTasksStore()
    deleted('a')
    notion.archiveTask.mockRejectedValueOnce(Object.assign(new Error('Bad request'), { statusCode: 400 }))

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('restored')

    expect(tasks.task('a')).toBeDefined()
    expect(tasks.pendingDeletes['a']).toBeUndefined()
    expect(useTrashStore().entry('a')).toBeUndefined()
    expect(statistics.removeDiscardedTime).toHaveBeenCalledWith('a')
    expect(handleErrorMock).toHaveBeenCalledWith(expect.any(Error), 'task_delete')
  })

  it('a flush that restores a task for good (not closeDelete) leaves no trash entry behind', async () => {
    deleted('a', 'queued')
    notion.archiveTask.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }))
    await useTaskSync().syncPendingChanges('notion')
    expect(useTasksStore().task('a')).toBeDefined()
    expect(useTrashStore().entry('a')).toBeUndefined()
  })

  it('a fetch while the delete is queued does not bring the task back', async () => {
    const tasks = useTasksStore()
    deleted('a')
    tasks.deletedTaskIds.push('a')
    notion.archiveTask.mockRejectedValueOnce(limited())
    await useTaskSync().commitTaskDelete('a')

    tasks.mergeTasks('notion', [notionTask('a')], { fetchStartedAt: now, pushing: () => false })
    expect(tasks.task('a')).toBeNull()
  })
})
