/**
 * #851: sequences on a Notion + Local board with the real error handler. While Notion cannot be reached the user is
 * told once, with the reassurance that the changes are kept; every further failing action stays quiet; after the
 * source answered again the next outage is told once more.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'

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
  archiveTask: vi.fn<(externalId: string) => Promise<void>>(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, setNotPlannedLimited: () => {}, config: { token: 't', statusMapping: { archive: null as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

/** What `NotionClientAPI` throws for a request that got no answer in the desktop app, and for an HTTP failure. */
const networkError = () => Object.assign(new Error('Network error'), { name: 'NotionAPIError', statusCode: 0 })
const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { name: 'NotionAPIError', statusCode })

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : `page-${id}`,
    title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

const toasts = () => toastAddMock.mock.calls.map((call) => call[0] as { title: string; description: string; color: string })
const unreachableToasts = () => toasts().filter((toast) => toast.title === 'Notion ist gerade nicht erreichbar')

let clock = Date.now() + 3_600_000

describe('unreachable source: told once per outage across sync sequences (#851)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(clock += 60_000)
    toastAddMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.updateTask.mockImplementation(async (t) => t)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([task('l1', 'local'), task('n1', 'notion'), task('n2', 'notion'), task('n3', 'notion')])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** The next user action happens later than the handler's window for identical messages. */
  const later = () => vi.setSystemTime(clock += 10_000)

  it.each([
    ['no connection (status 0)', networkError],
    ['a 502', () => httpError(502)],
  ])('%s: three failing actions on three tasks show one toast, a retry none; every change keeps its marker', async (_label, failure) => {
    notion.updateTask.mockImplementation(async () => { throw failure() })
    const { updateTaskStatus, editTask, syncPendingChanges } = useTaskSync()

    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })
    later()
    await updateTaskStatus({ taskId: 'n2', status: TaskStatus.Waiting })
    later()
    await editTask('n3', { title: 'Renamed' })
    later()
    await syncPendingChanges()

    expect(unreachableToasts()).toHaveLength(1)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.description).toBe('Deine Änderungen bleiben gespeichert und werden synchronisiert, sobald Notion wieder erreichbar ist.')
    for (const id of ['n1', 'n2', 'n3']) expect(useTasksStore().task(id)?.pendingSync).toBeDefined()
    expect(useTasksStore().task('n1')?.status).toBe(TaskStatus.Waiting)
  })

  it('outage, recovery by a write, second outage: told once each (A -> B -> A)', async () => {
    notion.updateTask.mockImplementation(async () => { throw httpError(503) })
    const { updateTaskStatus, syncPendingChanges } = useTaskSync()

    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })
    later()
    await updateTaskStatus({ taskId: 'n2', status: TaskStatus.Waiting })
    expect(unreachableToasts()).toHaveLength(1)

    notion.updateTask.mockImplementation(async (t) => t) // Notion answers again
    later()
    await syncPendingChanges()
    expect(useTasksStore().task('n1')?.pendingSync).toBeUndefined()

    notion.updateTask.mockImplementation(async () => { throw httpError(503) })
    later()
    await updateTaskStatus({ taskId: 'n3', status: TaskStatus.Waiting })
    later()
    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Open })
    expect(unreachableToasts()).toHaveLength(2)
    expect(toasts()).toHaveLength(2)
  })

  it('no connection, then the fetch of the recovered source, then no connection again: told once each', async () => {
    notion.updateTask.mockImplementation(async () => { throw networkError() })
    notion.fetchActiveBoardTasks.mockRejectedValue(networkError())
    const { updateTaskStatus } = useTaskSync()
    const { fetchTasks } = useIntegrationManager()

    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })
    later()
    await fetchTasks() // the periodic refresh fails too: quiet
    later()
    await updateTaskStatus({ taskId: 'n2', status: TaskStatus.Waiting })
    expect(unreachableToasts()).toHaveLength(1)
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('offline')

    notion.updateTask.mockImplementation(async (t) => t)
    notion.fetchActiveBoardTasks.mockResolvedValue([task('n1', 'notion'), task('n2', 'notion'), task('n3', 'notion')])
    later()
    await fetchTasks()
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')

    notion.updateTask.mockImplementation(async () => { throw networkError() })
    later()
    await updateTaskStatus({ taskId: 'n3', status: TaskStatus.Waiting })
    expect(unreachableToasts()).toHaveLength(2)
  })

  it('a task created while the browser is offline is kept and told once; a second create stays quiet', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { createTask } = useTaskSync()

    const first = await createTask({ title: 'Made offline' }, 'notion')
    later()
    await createTask({ title: 'Made offline too' }, 'notion')

    expect(notion.createTask).not.toHaveBeenCalled()
    expect(useTasksStore().task(first.id)?.pendingSync).toBeDefined()
    expect(unreachableToasts()).toHaveLength(1)
    expect(toasts()).toHaveLength(1)
  })

  it('a create that fails with no connection is kept and told once, not reported as an error', async () => {
    notion.createTask.mockRejectedValue(networkError())
    const { createTask, updateTaskStatus } = useTaskSync()
    notion.updateTask.mockImplementation(async () => { throw networkError() })

    const created = await createTask({ title: 'Made while unreachable' }, 'notion')
    later()
    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })

    expect(useTasksStore().task(created.id)?.pendingSync).toBeDefined()
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]!.color).toBe('warning')
  })

  it('a rejected token is not an outage: the broken path, no reassurance (#319)', async () => {
    notion.updateTask.mockImplementation(async () => { throw httpError(401) })
    const { updateTaskStatus } = useTaskSync()

    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })

    expect(unreachableToasts()).toHaveLength(0)
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('broken')
  })

  it('a Local task never tells anything', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { updateTaskStatus, createTask } = useTaskSync()

    await updateTaskStatus({ taskId: 'l1', status: TaskStatus.Waiting })
    await createTask({ title: 'Local one' }, 'local')

    expect(toasts()).toHaveLength(0)
  })
})
