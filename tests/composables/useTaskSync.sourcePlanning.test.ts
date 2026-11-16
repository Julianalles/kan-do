/**
 * #357: the user's plan and put-back are written to a source that stores planning (Notion with a "not planned"
 * status mapped), never to Local or Todoist and never for kan-do's own moves (`local: true`); and a Todoist sync
 * moves no card kan-do already holds (#387), only a task seen for the first time starts not planned.
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
    recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn(),
  }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

const fetchTodoist = vi.fn<() => Promise<Task[]>>()
const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  createTask: vi.fn<(draft: Partial<Task>) => Promise<Task>>(),
  archiveTask: vi.fn<(externalId: string) => Promise<void>>(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, setNotPlannedLimited: () => {}, config: { token: 't', statusMapping: { archive: 'Archive' as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return { fetchActiveBoardTasks: fetchTodoist, completeTask: vi.fn(), reopenTask: vi.fn() }
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { isNotPlanned } from '~/lib/taskPlanning'
/* eslint-enable import/first */

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : `page-${id}`,
    title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}
const mapping = notionConfig.config.statusMapping as { archive: string | null; notPlanned?: string[] }
// The adapter gets the live task: what it looked like when it was sent is noted at the call
const sent: Array<[string, boolean, string | undefined]> = []
const note = (t: Task) => { sent.push([t.id, t.notPlanned === true, t.sourceNotPlanned]) }
const sentToNotion = () => sent

describe('plan and put-back are written to a source that stores planning (#357)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    fetchTodoist.mockReset()
    sent.length = 0
    notion.updateTask.mockImplementation(async (t) => { note(t); return { ...t } })
    notion.createTask.mockImplementation(async (draft) => ({ ...task('created', 'notion'), ...draft, id: 'created', externalId: 'created' }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mapping.notPlanned = ['Backlog', 'Irgendwann']
    const board = useBoardStore()
    board.setSources({ connected: ['notion', 'todoist'], default: 'local' })
    board.setTodoistApiToken('token')
    useIntegrationHealthStore().recordSuccessfulSync('notion')
    useIntegrationHealthStore().recordSuccessfulSync('todoist')
  })
  afterEach(() => {
    delete mapping.notPlanned
    vi.restoreAllMocks()
  })
  const settle = () => vi.waitFor(() => expect(useTasksStore().pendingSyncTasks).toEqual([]))

  it('put-back writes the first mapped status, plan writes today; Local and Todoist tasks get no write', async () => {
    const store = useTasksStore()
    store.setTasks([task('n1', 'notion'), task('l1', 'local'), task('t1', 'todoist')])
    const sync = useTaskSync()

    expect(sync.unplanTasks(['n1', 'l1', 't1'])).toEqual(['n1', 'l1', 't1'])
    // marked at once, so a fetch that lands before the write keeps the local state
    expect(store.task('n1')).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Backlog' })
    expect(store.task('n1')!.pendingSync).toBeDefined()
    expect(store.task('l1')!.pendingSync).toBeUndefined()
    expect(store.task('t1')!.pendingSync).toBeUndefined()
    await settle()
    expect(sentToNotion()).toEqual([['n1', true, 'Backlog']])

    expect(sync.planTask('n1')).toBe(true)
    sync.planTasks(['l1', 't1'])
    await settle()
    expect(sentToNotion()).toEqual([['n1', true, 'Backlog'], ['n1', false, undefined]])
    expect(store.task('n1')!.sourceNotPlanned).toBeUndefined()
    // Todoist: the plan lives in kan-do only, nothing is noted for the source
    expect(store.task('t1')!.sourceNotPlanned).toBeUndefined()
    expect(isNotPlanned(store.task('t1')!)).toBe(false)
  })

  it('a task Notion holds in its second "not planned" status keeps it across plan-free edits and is written as today when planned', async () => {
    const store = useTasksStore()
    store.setTasks([task('n2', 'notion', { notPlanned: true, sourceNotPlanned: 'Irgendwann' })])
    const sync = useTaskSync()
    await sync.syncTaskToIntegration(store.task('n2')!)
    expect(sentToNotion()).toEqual([['n2', true, 'Irgendwann']])
    sync.planTask('n2')
    await settle()
    expect(sentToNotion().at(-1)).toEqual(['n2', false, undefined])
  })

  it('`local: true` and a Notion without the mapping change kan-do only', async () => {
    const store = useTasksStore()
    store.setTasks([task('n1', 'notion'), task('n3', 'notion')])
    const sync = useTaskSync()
    sync.unplanTasks(['n1'], { local: true })
    delete mapping.notPlanned
    sync.unplanTasks(['n3'])
    sync.planTasks(['n1', 'n3'])
    await Promise.resolve()
    expect(notion.updateTask).not.toHaveBeenCalled()
    expect(store.pendingSyncTasks).toEqual([])
    expect(store.task('n1')!.sourceNotPlanned).toBeUndefined()
  })

  it('a fetch that lands before the write keeps the put-back; the fetch after the write keeps it too', async () => {
    const store = useTasksStore()
    store.setTasks([task('n1', 'notion')])
    let release!: () => void
    notion.updateTask.mockImplementationOnce((t) => new Promise((resolve) => { note(t); release = () => resolve({ ...t }) }))
    useTaskSync().unplanTasks(['n1'])
    // Notion still says "today"
    store.mergeTasks('notion', [task('n1', 'notion')])
    expect(isNotPlanned(store.task('n1')!)).toBe(true)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await settle()
    // now Notion says Backlog: the same answer as the local value, nothing moves; then the user plans it in Notion
    store.mergeTasks('notion', [task('n1', 'notion', { sourceNotPlanned: 'Backlog' })])
    expect(isNotPlanned(store.task('n1')!)).toBe(true)
    store.mergeTasks('notion', [task('n1', 'notion')])
    expect(isNotPlanned(store.task('n1')!)).toBe(false)
  })

  it('a failed write keeps the marker for the retry', async () => {
    const store = useTasksStore()
    store.setTasks([task('n1', 'notion')])
    notion.updateTask.mockRejectedValueOnce(Object.assign(new Error('Notion API error'), { statusCode: 500 }))
    useTaskSync().unplanTasks(['n1'])
    await vi.waitFor(() => expect(store.task('n1')!.pendingSync?.lastError).toBeTruthy())
    expect(store.task('n1')).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Backlog' })
    await useTaskSync().syncPendingChanges('notion')
    expect(sentToNotion().at(-1)).toEqual(['n1', true, 'Backlog'])
    expect(store.pendingSyncTasks).toEqual([])
  })

  it('a task made as not planned in Notion is created with the first mapped status; in Offen it is created as before', async () => {
    const sync = useTaskSync()
    const made = await sync.createTask({ title: 'Neu', status: TaskStatus.Open, notPlanned: true }, 'notion')
    expect(notion.createTask.mock.calls[0]![0]).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Backlog' })
    expect(made).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Backlog' })
    await sync.createTask({ title: 'Heute', status: TaskStatus.Open }, 'notion')
    expect(notion.createTask.mock.calls[1]![0].sourceNotPlanned).toBeUndefined()
    expect(notion.createTask.mock.calls[1]![0].notPlanned).toBeUndefined()
  })
})

describe('a Todoist sync moves no card kan-do already holds (#357, #387)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    fetchTodoist.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const board = useBoardStore()
    board.setSources({ connected: ['todoist'], default: 'todoist' })
    board.setTodoistApiToken('token')
  })
  afterEach(() => vi.restoreAllMocks())
  const fetched = (id: string, overrides: Partial<Task> = {}) => task(id, 'todoist', { externalId: id, ...overrides })

  it('existing board, first sync after the update: Offen, Jetzt and their order stay; only the task seen for the first time starts not planned; nothing is written', async () => {
    const store = useTasksStore()
    const board = useBoardStore()
    store.setTasks([
      task('a', 'todoist', { externalId: 'a' }), task('b', 'todoist', { externalId: 'b' }),
      task('j', 'todoist', { externalId: 'j', status: TaskStatus.Progress }),
    ])
    board.reconcileColumnsWithTasks(store.tasks)
    board.moveToEndOfColumn(TaskStatus.Open, ['a']) // Offen shows b, a
    fetchTodoist.mockResolvedValue([fetched('a'), fetched('b'), fetched('j'), fetched('new')])

    await useIntegrationManager().fetchTasks()
    expect(store.tasksOpen.map(t => t.id)).toEqual(['b', 'a'])
    expect(store.task('j')!.status).toBe(TaskStatus.Progress)
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['new'])

    // the user's own plan and put-back stay across the next sync, and nothing is written to Todoist
    useTaskSync().planTasks(['new'])
    useTaskSync().unplanTasks(['b'])
    await useIntegrationManager().fetchTasks()
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a', 'new'])
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['b'])
    expect(store.pendingSyncTasks).toEqual([])
  })

  it('a new connection (no task held before): every open task starts not planned', async () => {
    fetchTodoist.mockResolvedValue([fetched('a'), fetched('b'), fetched('d', { status: TaskStatus.Done })])
    await useIntegrationManager().fetchTasks()
    expect(useTasksStore().tasksNotPlanned.map(t => t.id)).toEqual(['a', 'b'])
    expect(useTasksStore().task('d')!.status).toBe(TaskStatus.Done)
  })
})
