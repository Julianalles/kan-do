/**
 * #353: the two moves "plan for today" and "not today" go through `useTaskSync`, and the planned state lives in
 * kan-do only: no adapter is called for it, no `pendingSync` is set, and a fetch of the task's source that follows
 * keeps the task where the user put it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(),
    recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn(),
  }),
}))

/** One recording adapter per source: every write a move could cause would show up here. */
const fetched: Record<string, Task[]> = { notion: [], todoist: [] }
const writes = { create: vi.fn(), update: vi.fn(), remove: vi.fn(), restore: vi.fn() }
const fetchActive = vi.fn(async (source: SourceId) => fetched[source] ?? [])
vi.mock('~/composables/useTaskSources', () => ({
  useTaskSources: () => ({
    adapterFor: (source: SourceId) => ({
      id: source,
      syncsTime: source === 'notion',
      isConfigured: () => true,
      fetchActive: () => fetchActive(source),
      create: (...args: unknown[]) => writes.create(source, ...args),
      update: async (...args: unknown[]) => { writes.update(source, ...args); return null },
      remove: (...args: unknown[]) => writes.remove(source, ...args),
      restore: (...args: unknown[]) => writes.restore(source, ...args),
      archivesAsStatus: () => false,
      health: () => 'healthy' as const,
    }),
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
/* eslint-enable import/first */

function task(id: string, source: SourceId, overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : id,
    title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

describe('useTaskSync: plan for today and "not today" (#353)', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    Object.values(writes).forEach((fn) => fn.mockReset())
    fetchActive.mockClear()
    fetched.notion = []
    fetched.todoist = []
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('$fetch', fetchSpy)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'local' })
    useTasksStore().setTasks([
      task('l1', 'local'), task('n1', 'notion', { timeSpentSeconds: 300, notes: 'n' }), task('t1', 'todoist'), task('l2', 'local'),
    ])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const noWrite = () => {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  }

  it.each(['l1', 'n1', 't1'])('takes %s off the board and plans it again without a call to its source', async (id) => {
    const tasks = useTasksStore()
    const { planTask, unplanTask } = useTaskSync()
    const before = { ...tasks.task(id)! }

    expect(unplanTask(id)).toBe(true)
    expect(tasks.tasksOpen.map(t => t.id)).not.toContain(id)
    expect(tasks.tasksNotPlanned.map(t => t.id)).toEqual([id])
    expect(tasks.task(id)?.pendingSync).toBeUndefined()
    expect(tasks.hasPendingSync).toBe(false)

    expect(planTask(id)).toBe(true)
    expect(tasks.tasksOpen.at(-1)?.id).toBe(id)
    expect(tasks.task(id)).toEqual(before)

    await Promise.resolve()
    noWrite()
  })

  it('refuses "not today" for a task in Jetzt, and planning a task that is on the board', () => {
    const tasks = useTasksStore()
    tasks.updateTask('n1', { status: TaskStatus.Progress })
    const { planTask, unplanTask } = useTaskSync()
    expect(unplanTask('n1')).toBe(false)
    expect(planTask('l1')).toBe(false)
    expect(tasks.tasksProgress.map(t => t.id)).toEqual(['n1'])
    noWrite()
  })

  it('a sync after "not today" keeps the task off the board, for every connected source, and writes nothing', async () => {
    const tasks = useTasksStore()
    const { unplanTask } = useTaskSync()
    unplanTask('n1')
    unplanTask('t1')
    unplanTask('l2')
    fetched.notion = [task('n1', 'notion', { title: 'renamed in Notion', timeSpentSeconds: 300 })]
    fetched.todoist = [task('t1', 'todoist'), task('t2', 'todoist')]

    await useIntegrationManager().fetchTasks()
    await useIntegrationManager().fetchTasks()

    expect(tasks.tasksNotPlanned.map(t => t.id).sort()).toEqual(['l2', 'n1', 't1'])
    expect(tasks.task('n1')).toMatchObject({ title: 'renamed in Notion', timeSpentSeconds: 300, notPlanned: true })
    expect(tasks.tasksOpen.map(t => t.id).sort()).toEqual(['l1', 't2'])
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled()
  })

  it('an edit of a not-planned task is pushed like any other and leaves it not planned', async () => {
    const tasks = useTasksStore()
    const { unplanTask, syncTaskToIntegration } = useTaskSync()
    unplanTask('n1')
    tasks.updateTask('n1', { title: 'edited' })

    await syncTaskToIntegration(tasks.task('n1')!)

    expect(writes.update).toHaveBeenCalledTimes(1)
    expect(tasks.task('n1')).toMatchObject({ title: 'edited', notPlanned: true })
    expect(tasks.task('n1')?.pendingSync).toBeUndefined()
  })
})
