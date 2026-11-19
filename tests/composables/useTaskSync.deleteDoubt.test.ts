/**
 * #538: a Notion task whose create is in doubt (`pendingSync.createUncertain`, #528) that the user deletes. The page
 * may have landed: the delete looks for it with #528's lookup and archives it only when the lookup identifies it
 * (and no other doubt of the same title could own it). Nothing found before the create can no longer land keeps the
 * delete queued, without a toast; a fetch that brings the page in between hands it to the delete instead of making a
 * card.
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
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
/* eslint-enable import/first */

const T0 = Date.parse('2026-11-19T10:00:00.000Z')

const inDoubt = (id: string, title = 'Rückruf', input: Partial<Task> = {}): Task => ({
  id, source: 'notion', externalId: null, title, status: TaskStatus.Open, activity: null, topic: null,
  topicColorCode: 'blue', priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  pendingSync: { since: T0, attempts: 1, lastError: 'timeout', createUncertain: { since: T0, at: T0, title } },
  ...input,
})

const page = (id: string, title: string, createdAt: string): Task => ({
  ...inDoubt(id, title), externalId: id, createdAt: new Date(createdAt), pendingSync: undefined,
})

describe('deleting a Notion task whose create is in doubt (#538)', () => {
  let now = T0
  const tasks = () => useTasksStore()

  /** What the delete window leaves behind: the pending delete and its trash entry (the task is off the board). */
  const deleted = (task: Task, state: 'waiting' | 'queued' = 'waiting'): void => {
    tasks().addPendingDelete({ taskId: task.id, task, carryOver: null, state, requestedAt: now })
    useTrashStore().add({ taskId: task.id, task, deletedAt: now, fromStatus: TaskStatus.Open, carryOver: null })
  }

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.archiveTask.mockResolvedValue(undefined)
    notion.findLandedPage.mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    now = T0 + 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('archives the page the lookup finds, and the delete is committed', async () => {
    deleted(inDoubt('a'))
    notion.findLandedPage.mockResolvedValue('P')

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('committed')

    expect(notion.findLandedPage).toHaveBeenCalledWith('Rückruf', T0, expect.any(Set))
    expect(notion.archiveTask).toHaveBeenCalledWith('P')
    expect(tasks().pendingDeletes['a']).toBeUndefined()
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('nothing found while the create may still land: the delete stays queued, quietly, and nothing is archived', async () => {
    deleted(inDoubt('a'))

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('queued')

    expect(tasks().pendingDeletes['a']?.state).toBe('queued')
    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasks().task('a')).toBeNull()
    expect(useTrashStore().entry('a')).toBeDefined()
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('the periodic sync looks again; a page that landed late is archived, none found after the wait commits with nothing upstream', async () => {
    deleted(inDoubt('a'))
    deleted(inDoubt('b', 'Anderes'))
    await useTaskSync().commitTaskDelete('a')
    await useTaskSync().commitTaskDelete('b')

    now = T0 + 3 * 60_000
    notion.findLandedPage.mockImplementation(async (title) => (title === 'Rückruf' ? 'late' : null))
    await useTaskSync().syncPendingChanges('notion')

    expect(notion.archiveTask).toHaveBeenCalledTimes(1)
    expect(notion.archiveTask).toHaveBeenCalledWith('late')
    expect(tasks().pendingDeletes['a']).toBeUndefined()
    expect(tasks().pendingDeletes['b']).toBeUndefined() // nothing landed for it and it can no longer land
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a failed lookup keeps the delete queued without a toast and archives nothing', async () => {
    deleted(inDoubt('a'))
    now = T0 + 3 * 60_000
    notion.findLandedPage.mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { statusCode: 502 }))

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('queued')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasks().pendingDeletes['a']?.state).toBe('queued')
    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(tasks().task('a')).toBeNull()
  })

  it('a 429 on the lookup or on the archive pauses the source for the next deletes', async () => {
    deleted(inDoubt('a'))
    deleted(inDoubt('b', 'Anderes'))
    now = T0 + 3 * 60_000
    notion.findLandedPage.mockRejectedValueOnce(Object.assign(new Error('Too Many Requests'), { statusCode: 429, retryAfterMs: 30_000 }))
    await useTaskSync().commitTaskDelete('a')
    notion.findLandedPage.mockClear()

    await expect(useTaskSync().commitTaskDelete('b')).resolves.toBe('queued')
    expect(notion.findLandedPage).not.toHaveBeenCalled()
  })

  it('never archives a page when another task holds a doubt of the same title; the delete still completes', async () => {
    deleted(inDoubt('a'))
    tasks().setTasks([inDoubt('rival')])
    notion.findLandedPage.mockResolvedValue('P')

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasks().pendingDeletes['a']).toBeUndefined()
  })

  it('a doubt of another title is no rival', async () => {
    deleted(inDoubt('a'))
    tasks().setTasks([inDoubt('other', 'Anderes')])
    notion.findLandedPage.mockResolvedValue('P')
    await useTaskSync().commitTaskDelete('a')
    expect(notion.archiveTask).toHaveBeenCalledWith('P')
  })

  it('looks past the pages that cards, pending deletes and move origins hold', async () => {
    deleted(inDoubt('a'))
    tasks().setTasks([page('card', 'Rückruf', '2026-11-19T10:00:02.000Z')])
    notion.findLandedPage.mockResolvedValue(null)
    await useTaskSync().commitTaskDelete('a')
    expect([...notion.findLandedPage.mock.calls[0]![2]!]).toContain('card')
  })

  it('a fetch between the window and the commit hands the page to the delete: no card, the commit archives it', async () => {
    deleted(inDoubt('a'))
    tasks().deletedTaskIds.push('a')

    tasks().mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { fetchStartedAt: now, pushing: () => false })

    expect(tasks().tasks).toHaveLength(0)
    expect(tasks().pendingDeletes['a']?.task.externalId).toBe('P')
    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('committed')
    expect(notion.archiveTask).toHaveBeenCalledWith('P')
    expect(notion.findLandedPage).not.toHaveBeenCalled() // the page is known, no lookup
  })

  it('a delete that fails for good after a fetch handed it the page restores the task on that page (#535 review)', async () => {
    deleted(inDoubt('a'))
    now = T0 + 3 * 60_000 // the create can no longer land: the lookup alone decides
    // The fetch that hands the page over runs while the commit's lookup is under way
    notion.findLandedPage.mockImplementation(async () => {
      tasks().mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { fetchStartedAt: now, pushing: () => false })
      return null
    })
    notion.archiveTask.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }))

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('restored')

    expect(notion.archiveTask).toHaveBeenCalledWith('P')
    // Back on its page, with no doubt left: the next push updates P instead of creating a second page
    expect(tasks().task('a')).toMatchObject({ source: 'notion', externalId: 'P' })
    expect(tasks().task('a')?.pendingSync?.createUncertain).toBeUndefined()
    expect(tasks().deletedTaskIds).not.toContain('P')
    expect(handleErrorMock).toHaveBeenCalled()
  })

  it('the next fetch after the hand-over does not bring the page back either', async () => {
    deleted(inDoubt('a'))
    tasks().mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { fetchStartedAt: now, pushing: () => false })
    tasks().mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { fetchStartedAt: now, pushing: () => false })
    expect(tasks().tasks).toHaveLength(0)
  })

  it('undo inside the window after a hand-over puts the task back on its page', async () => {
    deleted(inDoubt('a'), 'waiting')
    tasks().mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { fetchStartedAt: now, pushing: () => false })
    expect(tasks().pendingDeletes['a']?.task).toMatchObject({ externalId: 'P' })
    expect(tasks().pendingDeletes['a']?.task.pendingSync?.createUncertain).toBeUndefined()
  })

  it('restoring the entry while the delete waits takes a handed-over page back with it, so a fetch does not skip it', async () => {
    deleted(inDoubt('a'), 'queued')
    tasks().mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { fetchStartedAt: now, pushing: () => false })
    expect(tasks().deletedTaskIds).toContain('P')

    await useTaskSync().restoreTask(useTrashStore().entry('a')!)

    expect(tasks().task('a')).toMatchObject({ source: 'notion', externalId: 'P' })
    expect(tasks().deletedTaskIds).not.toContain('P')
    expect(tasks().pendingDeletes['a']).toBeUndefined()
  })

  it('a disconnect with "sync first" counts such a delete as unsynced work', () => {
    deleted(inDoubt('a'))
    deleted({ ...inDoubt('b'), pendingSync: undefined })
    expect(tasks().unsyncedOf('notion').pendingDeleteIds).toEqual(['a'])
  })

  it('a task that never made a request upstream (no doubt) still deletes without any Notion call', async () => {
    deleted({ ...inDoubt('a'), pendingSync: { since: T0, attempts: 0, lastError: null } })
    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('committed')
    expect(notion.findLandedPage).not.toHaveBeenCalled()
    expect(notion.archiveTask).not.toHaveBeenCalled()
  })
})
