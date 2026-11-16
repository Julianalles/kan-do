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
/** What the Notion fetch says about its capped list (`NotionIntegration.notPlannedPartial` / `notPlannedLimited`) */
const notionList = { notPlannedPartial: [] as string[], notPlannedLimited: false }
const notionInstance = Object.defineProperties(notion, {
  notPlannedPartial: { get: () => notionList.notPlannedPartial },
  notPlannedLimited: { get: () => notionList.notPlannedLimited },
})
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, setNotPlannedLimited: () => {}, config: { token: 't', statusMapping: { archive: 'Archive' as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notionInstance }),
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
    for (const fn of [notion.fetchActiveBoardTasks, notion.updateTask, notion.createTask, notion.archiveTask]) fn.mockReset()
    notionList.notPlannedPartial = []
    notionList.notPlannedLimited = false
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

  // Review of PR 384: the value outlived the status move, the put-back read it as "Notion already holds it so",
  // wrote nothing, and the next sync put the card back into Offen
  it('a status move ends what Notion held: from its second "not planned" status to Jetzt, to Offen, then "Nicht heute" writes the first mapped status', async () => {
    const store = useTasksStore()
    store.setTasks([task('n4', 'notion', { notPlanned: true, sourceNotPlanned: 'Irgendwann' })])
    const sync = useTaskSync()
    await sync.updateTaskStatus({ taskId: 'n4', status: TaskStatus.Progress })
    expect(sentToNotion().at(-1)).toEqual(['n4', false, undefined])
    await sync.updateTaskStatus({ taskId: 'n4', status: TaskStatus.Open })
    await settle()
    sent.length = 0

    expect(sync.unplanTask('n4')).toBe(true)
    await settle()
    expect(sentToNotion()).toEqual([['n4', true, 'Backlog']])
    // Notion answers what kan-do holds, so the next fetch moves nothing
    store.mergeTasks('notion', [task('n4', 'notion', { sourceNotPlanned: 'Backlog' })])
    expect(isNotPlanned(store.task('n4')!)).toBe(true)
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

  // Review of PR 384: with more "not planned" pages in Notion than one sync loads, a held task past the cap was
  // dropped by the merge together with its unpushed edit
  it('a sync whose "not planned" list is capped keeps a held task the list lacks and pushes its unpushed edit', async () => {
    const store = useTasksStore()
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    store.setTasks([
      task('in', 'notion', { notPlanned: true, sourceNotPlanned: 'Backlog' }),
      task('past', 'notion', { notPlanned: true, sourceNotPlanned: 'Irgendwann', title: 'Offline umbenannt', timeSpentSeconds: 600 }),
    ])
    store.markPendingSync('past')
    notion.fetchActiveBoardTasks.mockResolvedValue([task('in', 'notion', { sourceNotPlanned: 'Backlog' })])
    notionList.notPlannedPartial = ['Backlog', 'Irgendwann']
    notionList.notPlannedLimited = true

    await useIntegrationManager().fetchTasks()
    expect(store.task('past')).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Irgendwann', title: 'Offline umbenannt', timeSpentSeconds: 600 })
    // the push that follows the merge carries the edit, in the status the page is held in
    await settle()
    expect(sentToNotion()).toEqual([['past', true, 'Irgendwann']])
    expect(notion.updateTask.mock.calls[0]![0].title).toBe('Offline umbenannt')

    // the same fetch as a complete list: Notion no longer has the page
    notionList.notPlannedPartial = []
    notionList.notPlannedLimited = false
    await useIntegrationManager().fetchTasks()
    expect(store.task('past')).toBeNull()
  })

  // Delta review of PR 384: the board query is read before the "not planned" query. A plan whose write reaches
  // Notion between the two reads is in neither answer, with a complete list too
  describe('a sync that was reading Notion while a plan was written', () => {
    const T0 = new Date('2026-11-16T09:00:00Z').getTime()
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0) })
    afterEach(() => vi.useRealTimers())
    const seed = () => {
      const store = useTasksStore()
      useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
      store.setTasks([task('board', 'notion'), task('held', 'notion', { notPlanned: true, sourceNotPlanned: 'Backlog', timeSpentSeconds: 600 })])
      return store
    }
    /** A fetch whose answer the test hands in: the list as Notion read it */
    const openFetch = () => {
      let answer!: (list: Task[]) => void
      notion.fetchActiveBoardTasks.mockImplementationOnce(() => new Promise<Task[]>((resolve) => { answer = resolve }))
      const done = useIntegrationManager().fetchTasks()
      return { done, answer: (list: Task[]) => { answer(list); return done } }
    }

    it('keeps the planned task a complete list lacks, and follows Notion at the next sync', async () => {
      const store = seed()
      const fetch = openFetch()
      await vi.waitFor(() => expect(notion.fetchActiveBoardTasks).toHaveBeenCalled())
      // the write lands after the board query was read and before the "not planned" query: the page is in neither
      vi.setSystemTime(T0 + 400)
      useTaskSync().planTask('held')
      await settle()
      vi.setSystemTime(T0 + 800)
      await fetch.answer([task('board', 'notion')])
      expect(store.task('held')).toMatchObject({ timeSpentSeconds: 600 })
      expect(store.tasksOpen.map(t => t.id)).toEqual(['board', 'held'])

      // the next sync read Notion after the write: the page is on the board there, the card stays where it is
      vi.setSystemTime(T0 + 60_000)
      notion.fetchActiveBoardTasks.mockResolvedValueOnce([task('board', 'notion'), task('held', 'notion')])
      await useIntegrationManager().fetchTasks()
      expect(store.tasksOpen.map(t => t.id)).toEqual(['board', 'held'])
      expect(store.task('held')!.timeSpentSeconds).toBe(600)
      // and a page that is gone at Notion is dropped by a sync that began after the write
      vi.setSystemTime(T0 + 120_000)
      notion.fetchActiveBoardTasks.mockResolvedValueOnce([task('board', 'notion')])
      await useIntegrationManager().fetchTasks()
      expect(store.task('held')).toBeNull()
    })

    it('keeps it while the write that began before the sync is still under way', async () => {
      const store = seed()
      let release!: () => void
      notion.updateTask.mockImplementationOnce((t) => new Promise((resolve) => { note(t); release = () => resolve({ ...t }) }))
      useTaskSync().planTask('held')
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      vi.setSystemTime(T0 + 400)
      const fetch = openFetch()
      await vi.waitFor(() => expect(notion.fetchActiveBoardTasks).toHaveBeenCalled())
      vi.setSystemTime(T0 + 800)
      await fetch.answer([task('board', 'notion')])
      expect(store.task('held')).not.toBeNull()
      release()
      await settle()
      expect(store.tasksOpen.map(t => t.id)).toEqual(['board', 'held'])
    })
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
