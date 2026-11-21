/**
 * #702 (review round 1): "Alle für heute einplanen" plans a panel through one `planTasks`: a source that stores planning is
 * written one task after another in the order given, a source that plans by date raises no toast of its own per task, the
 * one toast undoes exactly the tasks that moved, in their order, and a task moved on meanwhile keeps its place.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
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
const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  createTask: vi.fn(),
  archiveTask: vi.fn(),
  notPlannedPartial: [] as string[],
  notPlannedLimited: false,
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, setNotPlannedLimited: () => {}, config: { token: 't', statusMapping: { archive: 'Archive', notPlanned: ['Backlog'] } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

const toastAdd = vi.fn()
const toastRemove = vi.fn()
vi.mock('#imports', () => ({ useToast: () => ({ add: toastAdd, remove: toastRemove }) }))
vi.mock('~/composables/useIsDesktop', () => ({ isPhoneNow: () => false }))
const afterPlan = vi.fn()
vi.mock('~/composables/usePlanToasts', () => ({
  PLAN_TOAST_MS: 6000,
  usePlanToasts: () => ({ afterPlan, afterPutBack: vi.fn() }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { usePlanAll } from '~/composables/usePlanAll'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : `page-${id}`,
    title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, notPlanned: true, ...overrides,
  }
}

describe('usePlanAll', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    for (const fn of [notion.updateTask, toastAdd, toastRemove, afterPlan]) fn.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes a source that stores planning one task after another, in the order given, never in parallel', async () => {
    const store = useTasksStore()
    store.setTasks([task('n1', 'notion', { sourceNotPlanned: 'Backlog' }), task('n2', 'notion', { sourceNotPlanned: 'Backlog' }), task('n3', 'notion', { sourceNotPlanned: 'Backlog' })])
    const releases: Array<() => void> = []
    const sentIds: string[] = []
    notion.updateTask.mockImplementation((t) => new Promise((resolve) => { sentIds.push(t.id); releases.push(() => resolve({ ...t })) }))

    expect(await usePlanAll().planAll(['n1', 'n2', 'n3'])).toEqual(['n1', 'n2', 'n3'])
    // all three are planned and marked at once, the first write is out, the others wait for it
    expect(store.tasksNotPlanned).toEqual([])
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    expect(sentIds).toEqual(['n1'])
    releases[0]!()
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    expect(sentIds).toEqual(['n1', 'n2'])
    releases[1]!()
    await vi.waitFor(() => expect(releases).toHaveLength(3))
    releases[2]!()
    await vi.waitFor(() => expect(store.pendingSyncTasks).toEqual([]))
    expect(sentIds).toEqual(['n1', 'n2', 'n3'])
    expect(store.tasksOpen.map(el => el.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('says it once: one summary toast, no toast per task', async () => {
    useTasksStore().setTasks([task('a', 'local'), task('b', 'local')])
    await usePlanAll().planAll(['a', 'b'])
    expect(afterPlan).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledTimes(1)
    expect(toastAdd.mock.calls[0]![0]).toMatchObject({ title: '2 Aufgaben sind für heute geplant.' })
  })

  it('leaves a task out that is gone and says nothing when none moved', async () => {
    useTasksStore().setTasks([task('a', 'local')])
    expect(await usePlanAll().planAll(['gone'])).toEqual([])
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('undo puts the tasks back in the order they had; one moved on to Jetzt meanwhile stays where it is', async () => {
    const store = useTasksStore()
    store.setTasks([task('a', 'local'), task('b', 'local'), task('c', 'local')])
    await usePlanAll().planAll(['a', 'b', 'c'])
    expect(store.tasksNotPlanned).toEqual([])
    store.task('b')!.status = TaskStatus.Progress
    const action = (toastAdd.mock.calls[0]![0] as { actions: Array<{ onClick: () => void }> }).actions[0]!
    action.onClick()
    await vi.waitFor(() => expect(store.tasksNotPlanned.map(el => el.id)).toEqual(['a', 'c']))
    expect(store.task('b')).toMatchObject({ status: TaskStatus.Progress })
  })
})
