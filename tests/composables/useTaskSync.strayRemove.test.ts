/**
 * #578: a fetch that lands while a create is in flight makes a card of the page the create is making (#555). The
 * user deletes that card, or moves it to another source, in that window: the pending delete or the move-origin
 * removal then holds the page P. When the create resolves with P and stores it on the waiting task, the removal
 * must not archive P: the waiter's page is not the user's to delete. The page comes back in the create's own response
 * (a lookup would not return it: a page that has a card is claimed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import { mapHelpers } from '~/utils/mapHelpers'
import type { Task } from '~/types/task'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn(),
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

const statusError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

const notionPage = (pageId: string, input: Partial<Task>): Task => ({
  id: pageId, source: 'notion', externalId: pageId,
  title: input.title ?? 'Untitled', status: input.status ?? TaskStatus.Open, activity: null, topic: null,
  topicColorCode: 'blue', priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
})

const draft: Partial<Task> = { title: 'Rückruf', status: TaskStatus.Open, priority: 1 }

describe('removing the stray card a fetch made of an in-flight create\'s page (#578)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let sync: ReturnType<typeof useTaskSync>
  let release: () => void
  let fail: (error: Error) => void

  /** The waiter (an offline-made task) is being pushed: its create is held. A fetch lands P and makes a card of it. */
  const strayWhileCreateInFlight = async () => {
    tasksStore.addTask({ ...notionPage('local_w', draft), externalId: null })
    tasksStore.markPendingSync('local_w')
    notion.createTask.mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve, reject) => { release = resolve; fail = reject })
      return notionPage('P', input)
    })
    sync = useTaskSync()
    const running = sync.syncPendingChanges('notion')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    tasksStore.mergeTasks('notion', [notionPage('P', draft)], { fetchStartedAt: Date.now(), pushing: sync.isPushing })
    expect(tasksStore.task('P')).toBeDefined()
    return { running }
  }

  /** What the delete flow leaves once the user's window closed: the card is off the board, its delete waits to commit */
  const deleteStray = () => {
    const stray = tasksStore.task('P')!
    tasksStore.removeTask('P')
    tasksStore.addPendingDelete({ taskId: 'P', task: stray, carryOver: null, state: 'waiting', requestedAt: Date.now() })
  }

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.createTask.mockImplementation(async (input) => notionPage('page-new', input))
    notion.updateTask.mockImplementation(async (task) => ({ ...task }))
    notion.findLandedPage.mockResolvedValue(null)
    notion.archiveTask.mockResolvedValue(undefined)
    release = undefined as never
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    tasksStore = useTasksStore()
    tasksStore.setTasks([])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('a delete of the stray card, committed after the create resolved, does not archive the waiter\'s page', async () => {
    const { running } = await strayWhileCreateInFlight()
    deleteStray()

    release()
    await running
    expect(tasksStore.task('local_w')).toMatchObject({ externalId: 'P' })

    await expect(sync.commitTaskDelete('P')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'P')).toBeUndefined()
    expect(tasksStore.task('local_w')).toMatchObject({ externalId: 'P' })
    // The page left the deleted ids with the skipped removal: a later fetch still reaches the waiting task
    expect(tasksStore.deletedTaskIds).not.toContain('P')
    tasksStore.mergeTasks('notion', [notionPage('P', { ...draft, title: 'Rückruf (Notion)' })], { fetchStartedAt: Date.now(), pushing: sync.isPushing })
    expect(tasksStore.tasks.map((t) => [t.id, t.externalId])).toEqual([['local_w', 'P']])
  })

  it('a delete that commits while the create is in flight waits, and does not archive once the page sits on the waiter', async () => {
    const { running } = await strayWhileCreateInFlight()
    deleteStray()

    await expect(sync.commitTaskDelete('P')).resolves.toBe('queued')
    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'P')?.state).toBe('queued')

    release()
    await running
    await expect(sync.commitTaskDelete('P')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasksStore.task('local_w')).toMatchObject({ externalId: 'P' })
  })

  it('a held delete still archives the page when the create did not store it (the user\'s own delete is honoured)', async () => {
    const { running } = await strayWhileCreateInFlight()
    deleteStray()
    await expect(sync.commitTaskDelete('P')).resolves.toBe('queued')

    fail(statusError(400))
    await running
    expect(tasksStore.task('local_w')).toMatchObject({ externalId: null })
    await expect(sync.commitTaskDelete('P')).resolves.toBe('committed')

    expect(notion.archiveTask).toHaveBeenCalledWith('P')
  })

  it('a move of the stray card to Local does not archive the waiter\'s page as the origin', async () => {
    const { running } = await strayWhileCreateInFlight()
    tasksStore.reassignSource('P', 'local')

    release()
    await running
    expect(tasksStore.task('local_w')).toMatchObject({ externalId: 'P' })

    await expect(sync.commitTaskMove('P')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasksStore.task('local_w')).toMatchObject({ source: 'notion', externalId: 'P' })
    expect(tasksStore.task('P')).toMatchObject({ source: 'local' })
    expect(tasksStore.task('P')?.pendingMove).toBeUndefined()
  })

  it('a move origin removal that comes while the create is in flight waits', async () => {
    const { running } = await strayWhileCreateInFlight()
    tasksStore.reassignSource('P', 'local')

    await expect(sync.commitTaskMove('P')).resolves.toBe('queued')
    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasksStore.task('P')?.pendingMove).toBeDefined()

    release()
    await running
    await expect(sync.commitTaskMove('P')).resolves.toBe('committed')
    expect(notion.archiveTask).not.toHaveBeenCalled()
  })

  it('the add form\'s task (its id is the page id) is not archived by the delete of the stray card either', async () => {
    notion.createTask.mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => { release = resolve })
      return notionPage('P', input)
    })
    sync = useTaskSync()
    const adding = sync.createTask(draft, 'notion')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    tasksStore.mergeTasks('notion', [notionPage('P', draft)], { fetchStartedAt: Date.now(), pushing: sync.isPushing })
    deleteStray()

    release()
    await adding
    expect(tasksStore.tasks.map((t) => [t.id, t.externalId])).toEqual([['P', 'P']])

    await expect(sync.commitTaskDelete('P')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasksStore.tasks.map((t) => [t.id, t.externalId])).toEqual([['P', 'P']])
    expect(tasksStore.deletedTaskIds).not.toContain('P')
  })

  /** A focus fetch while the held removal waits for the next flush: P is still in the deleted ids / moved-away pages */
  const fetchP = () => tasksStore.mergeTasks('notion', [notionPage('P', { ...draft, title: 'Rückruf (Notion)' })], { fetchStartedAt: Date.now(), pushing: sync.isPushing })

  it('fetches that land between the write and the held delete\'s commit keep the waiter on the board', async () => {
    const { running } = await strayWhileCreateInFlight()
    deleteStray()
    await expect(sync.commitTaskDelete('P')).resolves.toBe('queued')

    release()
    await running
    fetchP()
    fetchP()
    expect(tasksStore.tasks.map((t) => [t.id, t.externalId])).toEqual([['local_w', 'P']])

    await expect(sync.commitTaskDelete('P')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasksStore.tasks.map((t) => [t.id, t.externalId])).toEqual([['local_w', 'P']])
  })

  it('fetches that land between the write and the held move origin\'s removal keep the waiter on the board', async () => {
    const { running } = await strayWhileCreateInFlight()
    tasksStore.reassignSource('P', 'local')
    await expect(sync.commitTaskMove('P')).resolves.toBe('queued')

    release()
    await running
    fetchP()
    fetchP()
    expect(tasksStore.tasks.map((t) => [t.id, t.source, t.externalId]).sort()).toEqual([['P', 'local', null], ['local_w', 'notion', 'P']])

    await expect(sync.commitTaskMove('P')).resolves.toBe('committed')

    expect(notion.archiveTask).not.toHaveBeenCalled()
    expect(tasksStore.task('local_w')).toMatchObject({ source: 'notion', externalId: 'P' })
  })

  it('a page no live card holds stays skipped as deleted by a fetch (the user\'s delete is not undone)', async () => {
    tasksStore.addTask(notionPage('Q', { title: 'Anderes' }))
    const card = tasksStore.task('Q')!
    tasksStore.removeTask('Q')
    tasksStore.addPendingDelete({ taskId: 'Q', task: card, carryOver: null, state: 'waiting', requestedAt: Date.now() })
    sync = useTaskSync()

    tasksStore.mergeTasks('notion', [notionPage('Q', { title: 'Anderes' })], { fetchStartedAt: Date.now(), pushing: sync.isPushing })

    expect(tasksStore.tasks).toEqual([])
  })

  it('an ordinary delete (no write in flight, no other card holds the page) archives the page as before', async () => {
    tasksStore.addTask(notionPage('Q', { title: 'Anderes' }))
    const card = tasksStore.task('Q')!
    tasksStore.removeTask('Q')
    tasksStore.addPendingDelete({ taskId: 'Q', task: card, carryOver: null, state: 'waiting', requestedAt: Date.now() })

    await expect(useTaskSync().commitTaskDelete('Q')).resolves.toBe('committed')

    expect(notion.archiveTask).toHaveBeenCalledWith('Q')
  })

  it('a throw in the settle step of a create frees the removals too (the counter is released in a finally)', async () => {
    sync = useTaskSync()
    vi.spyOn(tasksStore, 'addTask').mockImplementationOnce(() => { throw new Error('settle failed') })
    await expect(sync.createTask(draft, 'notion')).rejects.toThrow('settle failed')
    tasksStore.addTask(notionPage('Q', { title: 'Anderes' }))
    const card = tasksStore.task('Q')!
    tasksStore.removeTask('Q')
    tasksStore.addPendingDelete({ taskId: 'Q', task: card, carryOver: null, state: 'waiting', requestedAt: Date.now() })

    await expect(sync.commitTaskDelete('Q')).resolves.toBe('committed')
    expect(notion.archiveTask).toHaveBeenCalledWith('Q')
  })

  it('a create that fails frees the removals: the hold ends with the write, never sticks', async () => {
    tasksStore.addTask({ ...notionPage('local_w', draft), externalId: null })
    tasksStore.markPendingSync('local_w')
    notion.createTask.mockRejectedValueOnce(statusError(400))
    sync = useTaskSync()
    await sync.syncPendingChanges('notion')
    tasksStore.addTask(notionPage('Q', { title: 'Anderes' }))
    const card = tasksStore.task('Q')!
    tasksStore.removeTask('Q')
    tasksStore.addPendingDelete({ taskId: 'Q', task: card, carryOver: null, state: 'waiting', requestedAt: Date.now() })

    await expect(sync.commitTaskDelete('Q')).resolves.toBe('committed')
    expect(notion.archiveTask).toHaveBeenCalledWith('Q')
  })
})
