/**
 * #551: a task of a source that is read-only in kan-do (Apple Reminders) never reaches `adapter.create`, `remove` or
 * `restore`, whatever entry point asks: add (also while the source is down), delete (the card menu's path and a committed
 * pending delete), restore from the trash, move out of it and move into it. The done tick is the one write and still goes
 * through `adapter.update`. Local and Notion tasks are not affected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import { SourceReadOnlyError, type TaskSourceAdapter } from '~/integrations/sources/types'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }),
}))

const adapters = {} as Record<SourceId, ReturnType<typeof fakeAdapter>>
function fakeAdapter(id: SourceId) {
  return {
    id,
    syncsTime: false,
    isConfigured: () => true,
    fetchActive: vi.fn(async () => [] as Task[]),
    create: vi.fn(async (draft: Partial<Task>) => ({ ...draft, id: `${id}-new`, externalId: `${id}-new`, source: id }) as Task),
    update: vi.fn(async (): Promise<Task | null> => null),
    remove: vi.fn(async () => {}),
    restore: vi.fn(async (task: Task) => task),
    archivesAsStatus: () => false,
    health: () => 'healthy' as const,
  } satisfies TaskSourceAdapter
}
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: (id: SourceId) => adapters[id] }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTaskMove } from '~/composables/useTaskMove'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
import { buildMoveTargets } from '~/composables/useTaskMoveTargets'
/* eslint-enable import/first */

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id'>): Task => {
  const source = overrides.source ?? 'local'
  return {
    title: `Task ${overrides.id}`, notes: null, status: TaskStatus.Open, priority: 2, activity: null, timeBoxSeconds: null,
    timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null, source,
    externalId: source === 'local' ? null : overrides.id, createdAt: new Date('2026-01-01T00:00:00Z'), ...overrides,
  }
}
const reminder = (id: string, over: Partial<Task> = {}) => makeTask({ id, source: 'reminders', reminders: { due: null, recurrence: null, listId: 'L1' }, ...over })

const expectNoWritesBeyondUpdate = () => {
  const reminders = adapters.reminders
  expect(reminders.create).not.toHaveBeenCalled()
  expect(reminders.remove).not.toHaveBeenCalled()
  expect(reminders.restore).not.toHaveBeenCalled()
}

describe('a Reminders task is read-only through every useTaskSync entry point (#551)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    for (const id of ['local', 'notion', 'todoist', 'reminders'] as const) adapters[id] = fakeAdapter(id)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['reminders', 'notion'], default: 'local' })
    tasksStore = useTasksStore()
  })
  afterEach(() => vi.restoreAllMocks())

  it('add: createTask in Reminders throws the typed error, also while the source needs attention or the browser is offline', async () => {
    await expect(useTaskSync().createTask({ title: 'New', status: TaskStatus.Open }, 'reminders')).rejects.toBeInstanceOf(SourceReadOnlyError)
    expectNoWritesBeyondUpdate()
    expect(tasksStore.tasks).toHaveLength(0)

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await expect(useTaskSync().createTask({ title: 'New', status: TaskStatus.Open }, 'reminders')).rejects.toBeInstanceOf(SourceReadOnlyError)
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    expectNoWritesBeyondUpdate()
    expect(tasksStore.tasks).toHaveLength(0)
  })

  it('add: Local and Notion still create', async () => {
    await useTaskSync().createTask({ title: 'L', status: TaskStatus.Open }, 'local')
    await useTaskSync().createTask({ title: 'N', status: TaskStatus.Open }, 'notion')
    expect(adapters.notion.create).toHaveBeenCalledTimes(1)
    expect(tasksStore.tasks).toHaveLength(2)
  })

  it('delete: the card-menu path refuses, and a pending delete that gets committed never reaches the adapter', async () => {
    tasksStore.setTasks([reminder('r1')])
    expect(useTaskDeletion().deleteTaskWithUndo('r1')).toBe(false)
    expect(tasksStore.task('r1')).toBeDefined()
    expect(tasksStore.pendingDeletes).toEqual({})

    // Whatever gets a delete of a Reminders task queued (imported data, a bug) is refused on the way upstream
    await expect(useTaskSync().deleteTaskUpstream({ taskId: 'r1', task: reminder('r1'), state: 'queued' } as never)).rejects.toBeInstanceOf(SourceReadOnlyError)
    expectNoWritesBeyondUpdate()
  })

  it('restore: a trash entry of a Reminders task is not restored through the adapter', async () => {
    const trash = useTrashStore()
    trash.add({ taskId: 'r1', task: reminder('r1'), deletedAt: Date.now(), fromStatus: TaskStatus.Open, carryOver: { days: 0, keptAtDays: 0, lastSeenDay: '2026-11-19' } as never })
    await expect(useTaskSync().restoreTask(trash.entry('r1')!)).rejects.toBeInstanceOf(SourceReadOnlyError)
    expectNoWritesBeyondUpdate()
    expect(tasksStore.task("r1")).toBeNull()
  })

  it('move: neither out of Reminders nor into it', () => {
    tasksStore.setTasks([reminder('r1'), makeTask({ id: 'l1' })])
    const { moveTaskToSource } = useTaskMove()
    expect(moveTaskToSource('r1', 'local')).toBe(false)
    expect(moveTaskToSource('r1', 'notion')).toBe(false)
    expect(moveTaskToSource('l1', 'reminders')).toBe(false)
    expect(tasksStore.task('r1')).toMatchObject({ source: 'reminders', externalId: 'r1' })
    expect(tasksStore.task('l1')).toMatchObject({ source: 'local', externalId: null })
    expect(tasksStore.task('r1')!.pendingMove).toBeUndefined()
    expectNoWritesBeyondUpdate()
  })

  it('"Verschieben zu": a Reminders task has no entry, and Reminders is never a target of another task', () => {
    const t = (key: string) => key
    const base = { t, connected: ['reminders', 'notion'] as const, notionMapping: null, needsAttention: () => false }
    expect(buildMoveTargets({ ...base, task: reminder('r1') })).toEqual([])
    expect(buildMoveTargets({ ...base, task: makeTask({ id: 'l1' }) }).map(target => target.source)).toEqual(['notion'])
  })

  it('the done tick still goes through adapter.update (the one write)', async () => {
    tasksStore.setTasks([reminder('r1')])
    await useTaskSync().updateTaskStatus({ taskId: 'r1', status: TaskStatus.Done })
    expect(adapters.reminders.update).toHaveBeenCalledTimes(1)
    expect(adapters.reminders.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', status: TaskStatus.Done }), expect.objectContaining({ previousStatus: TaskStatus.Open }))
    expect(tasksStore.task('r1')!.pendingSync).toBeUndefined()
    expectNoWritesBeyondUpdate()
  })
})
