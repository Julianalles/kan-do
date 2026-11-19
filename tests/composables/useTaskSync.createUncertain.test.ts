/**
 * #528: a create whose outcome is unknown (a timeout, a network error, a 5xx) may have made the Notion page. The task
 * is kept with `pendingSync.createUncertain`, and the next push looks the page up before it creates: found = adopted,
 * never a second page; not found = created; a failed lookup = still queued, nothing created.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { afterTheLandingWait } from '../helpers/landingWait'

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

const statusError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

const notionPage = (pageId: string, input: Partial<Task>): Task => ({
  id: pageId, source: 'notion', externalId: pageId,
  title: input.title ?? 'Untitled', status: input.status ?? TaskStatus.Open, activity: null, topic: null,
  topicColorCode: 'blue', priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
})

const draft: Partial<Task> = { title: 'Rückruf', status: TaskStatus.Open, priority: 1 }

describe('a Notion create with an unknown outcome (#528)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.createTask.mockImplementation(async (input) => notionPage('page-new', input))
    notion.updateTask.mockImplementation(async (task) => ({ ...task }))
    notion.findLandedPage.mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['a timeout or network error (status 0)', 0],
    ['a gateway error (502)', 502],
    ['a server error (500)', 500],
  ])('%s marks the task, and the page that did land is adopted: one page, the id unchanged', async (_name, status) => {
    const tasksStore = useTasksStore()
    const before = Date.now()
    notion.createTask.mockRejectedValueOnce(statusError(status))
    const created = await useTaskSync().createTask(draft, 'notion')
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain).toEqual({ since: expect.any(Number), at: expect.any(Number), title: 'Rückruf' })
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain?.since).toBeGreaterThanOrEqual(before)

    notion.findLandedPage.mockResolvedValueOnce('page-landed')
    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')

    expect(notion.findLandedPage).toHaveBeenCalledWith('Rückruf', expect.any(Number), expect.any(Set))
    expect(notion.createTask).toHaveBeenCalledTimes(1) // the doubtful first try only: no second create
    expect(tasksStore.task(created.id)).toMatchObject({ id: created.id, externalId: 'page-landed' })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
    expect(tasksStore.tasks).toHaveLength(1)
    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'page-landed' }))
  })

  it('a create that did not land is created on the next push: the task is never lost', async () => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(statusError(0))
    const created = await useTaskSync().createTask(draft, 'notion')

    afterTheLandingWait()
    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')

    expect(notion.findLandedPage).toHaveBeenCalledTimes(1)
    expect(notion.createTask).toHaveBeenCalledTimes(2)
    expect(tasksStore.task(created.id)).toMatchObject({ id: created.id, externalId: 'page-new' })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
  })

  it('a failed lookup creates nothing: the task stays queued with its doubt and is adopted by the next push', async () => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(statusError(0))
    const created = await useTaskSync().createTask(draft, 'notion')
    const doubt = tasksStore.task(created.id)?.pendingSync?.createUncertain

    notion.findLandedPage.mockRejectedValueOnce(statusError(503))
    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(created.id)).toMatchObject({ externalId: null })
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain).toEqual(doubt) // a lookup is no create: the doubt is unchanged

    notion.findLandedPage.mockResolvedValueOnce('page-landed')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(created.id)).toMatchObject({ externalId: 'page-landed' })
  })

  it('a failing write onto the found page creates nothing and keeps the title of the page that landed', async () => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(statusError(502))
    const created = await useTaskSync().createTask(draft, 'notion')
    tasksStore.updateTask(created.id, { title: 'Rückruf (neu)' })

    notion.findLandedPage.mockResolvedValue('page-landed')
    notion.updateTask.mockRejectedValueOnce(statusError(502))
    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain?.title).toBe('Rückruf')

    await useTaskSync().syncPendingChanges('notion')
    expect(tasksStore.task(created.id)).toMatchObject({ externalId: 'page-landed' })
  })

  it('looks the page up under the title of the failed create, not an edited one, and never claims a page another task holds', async () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask({ ...notionPage('page-held', { title: 'Rückruf' }), pendingSync: undefined })
    notion.createTask.mockRejectedValueOnce(statusError(0))
    const created = await useTaskSync().createTask(draft, 'notion')
    tasksStore.updateTask(created.id, { title: 'Rückruf 2' })

    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    const [title, , claimed] = notion.findLandedPage.mock.calls[0]!
    expect(title).toBe('Rückruf')
    expect([...(claimed ?? [])]).toContain('page-held')
  })

  it.each([
    ['a rate limit (429)', 429],
    ['no access (403)', 403],
  ])('%s refused the create before a page was made: no doubt, no lookup', async (_name, status) => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(statusError(status))
    const created = await useTaskSync().createTask(draft, 'notion')
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain).toBeUndefined()

    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.findLandedPage).not.toHaveBeenCalled()
    expect(tasksStore.task(created.id)).toMatchObject({ externalId: 'page-new' })
  })

  it('a push of a task made offline that times out sets the doubt, and the one after it adopts the page', async () => {
    const tasksStore = useTasksStore()
    useIntegrationHealthStore().recordFailure('notion', statusError(401))
    const created = await useTaskSync().createTask(draft, 'notion') // needs attention: nothing is called
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain).toBeUndefined()

    useIntegrationHealthStore().markHealthy('notion')
    notion.createTask.mockRejectedValueOnce(statusError(0))
    await useTaskSync().syncPendingChanges('notion')
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain).toMatchObject({ title: 'Rückruf' })
    expect(notion.findLandedPage).not.toHaveBeenCalled() // the first create of this task had no doubt before it

    notion.findLandedPage.mockResolvedValueOnce('page-landed')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(created.id)).toMatchObject({ externalId: 'page-landed' })
  })

  it('a fetch that returns the landed page before the push hands it to the waiting task: one page, one card (review of #536)', async () => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(statusError(0))
    const created = await useTaskSync().createTask(draft, 'notion')
    const since = tasksStore.task(created.id)!.pendingSync!.createUncertain!.since

    // The periodic sync reads the page the doubtful create made, before anything is pushed
    tasksStore.mergeTasks('notion', [{ ...notionPage('page-landed', { title: 'Rückruf' }), createdAt: new Date(since + 4000) }])
    expect(tasksStore.tasks).toHaveLength(1)

    afterTheLandingWait()
    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1) // the doubtful try only
    expect(tasksStore.tasks).toHaveLength(1)
    expect(tasksStore.task(created.id)).toMatchObject({ id: created.id, externalId: 'page-landed' })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'page-landed' }))
  })

  it('a lookup that finds nothing waits while the doubtful create can still land, quietly, and creates after that (review of #536)', async () => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(statusError(0))
    const created = await useTaskSync().createTask(draft, 'notion')
    const doubt = tasksStore.task(created.id)?.pendingSync?.createUncertain
    const attempts = tasksStore.task(created.id)?.pendingSync?.attempts

    useIntegrationHealthStore().markHealthy('notion')
    handleErrorMock.mockClear()
    await useTaskSync().syncPendingChanges('notion') // the proxy may still be waiting on Notion
    expect(notion.findLandedPage).toHaveBeenCalledTimes(1)
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(tasksStore.task(created.id)?.pendingSync?.createUncertain).toEqual(doubt)
    expect(tasksStore.task(created.id)?.pendingSync?.attempts).toBe(attempts)
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')

    // The page lands late: the next push finds it, still inside the wait
    notion.findLandedPage.mockResolvedValueOnce('page-late')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(created.id)).toMatchObject({ externalId: 'page-late' })
  })
})
