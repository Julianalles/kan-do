/**
 * #538: a Notion task whose create is in doubt (#528) that is moved to another source. The origin page may exist: the
 * move carries the doubt (`pendingMove.fromCreateUncertain`), the origin removal settles it after the target holds
 * the task, an undo or a rejected target create puts it back on the marker, and a fetch that brings the page in
 * between hands it to the move instead of making a second card.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { CreateUncertain, Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import type { CreateContext, TaskSourceAdapter } from '~/integrations/sources/types'
import { CreateLookupError, CreateWaitingError } from '~/lib/integrationHealth'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
const statistics = { recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }
vi.mock('~/store/taskStatistics', () => ({ useTaskStatisticsStore: () => statistics }))

const calls: string[] = []
const adapters = {} as Record<SourceId, ReturnType<typeof fakeAdapter>>
let pageCounter = 0

function fakeAdapter(id: SourceId) {
  return {
    id,
    syncsTime: id === 'notion',
    isConfigured: () => true,
    fetchActive: vi.fn(async () => [] as Task[]),
    create: vi.fn(async (draft: Partial<Task>): Promise<Task> => {
      calls.push(`create:${id}`)
      const externalId = `${id}-page-${++pageCounter}`
      return { ...(draft as Task), id: externalId, source: id, externalId }
    }),
    update: vi.fn(async (task: Task): Promise<Task | null> => { calls.push(`update:${id}:${task.externalId}`); return null }),
    remove: vi.fn(async (task: Task) => { calls.push(`remove:${id}:${task.externalId}`) }),
    removeLanded: vi.fn(async (_doubt: CreateUncertain, _ctx: CreateContext) => { calls.push(`removeLanded:${id}`) }),
    restore: vi.fn(async (task: Task): Promise<Task> => task),
    archivesAsStatus: () => false,
    health: () => 'healthy' as const,
  } satisfies TaskSourceAdapter
}
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: (id: SourceId) => adapters[id] }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { onTaskMoveRejected } from '~/lib/taskMoveEvents'
/* eslint-enable import/first */

const T0 = Date.parse('2026-11-19T10:00:00.000Z')
const DOUBT: CreateUncertain = { since: T0, at: T0, title: 'Rückruf' }

const inDoubt = (id: string, input: Partial<Task> = {}): Task => ({
  id, source: 'notion', externalId: null, title: 'Rückruf', status: TaskStatus.Open, activity: null, topic: null,
  topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  pendingSync: { since: T0, attempts: 1, lastError: 'timeout', createUncertain: DOUBT },
  ...input,
})

describe('moving a Notion task whose create is in doubt (#538)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let stopListening: () => void

  const move = (taskId: string, target: SourceId) => {
    const previous = tasksStore.reassignSource(taskId, target)
    tasksStore.holdMove(taskId)
    return previous
  }

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    calls.length = 0
    pageCounter = 0
    handleErrorMock.mockReset()
    for (const id of ['local', 'notion', 'todoist'] as const) adapters[id] = fakeAdapter(id)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(T0 + 10_000)
    useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'local' })
    tasksStore = useTasksStore()
    const health = useIntegrationHealthStore()
    health.recordSuccessfulSync('notion')
    health.recordSuccessfulSync('todoist')
    stopListening = onTaskMoveRejected(() => {})
  })
  afterEach(() => {
    stopListening()
    vi.restoreAllMocks()
  })

  it('reassign keeps the doubt on the move; the origin has no page id to remove', () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'todoist')
    const moved = tasksStore.task('a')!
    expect(moved.pendingMove).toEqual({ fromSource: 'notion', fromExternalId: null, toSource: 'todoist', fromCreateUncertain: DOUBT })
    expect(moved.externalId).toBeNull()
  })

  it('a task with a page id, a Local origin and a task without a doubt record no doubt', () => {
    tasksStore.setTasks([
      inDoubt('page', { externalId: 'P', pendingSync: undefined }),
      inDoubt('plain', { pendingSync: { since: T0, attempts: 0, lastError: null } }),
    ])
    move('page', 'todoist')
    move('plain', 'todoist')
    expect(tasksStore.task('page')?.pendingMove?.fromCreateUncertain).toBeUndefined()
    expect(tasksStore.task('plain')?.pendingMove?.fromCreateUncertain).toBeUndefined()
  })

  it('Notion -> Todoist: the target creates first, then the origin page is looked up and archived', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'todoist')
    tasksStore.releaseMove('a')

    await expect(useTaskSync().commitTaskMove('a')).resolves.toBe('committed')

    expect(calls).toEqual(['create:todoist', 'removeLanded:notion'])
    expect(adapters.notion.removeLanded).toHaveBeenCalledWith(DOUBT, { claimedExternalIds: expect.any(Set) })
    expect(tasksStore.task('a')?.pendingMove).toBeUndefined()
    expect(tasksStore.task('a')).toMatchObject({ source: 'todoist', externalId: 'todoist-page-1' })
  })

  it('Notion -> Local: nothing is created, the origin page is settled', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'local')
    tasksStore.releaseMove('a')
    await expect(useTaskSync().commitTaskMove('a')).resolves.toBe('committed')
    expect(calls).toEqual(['removeLanded:notion'])
  })

  it('while a late create may still land the move stays queued, quietly, and the next flush settles it', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'todoist')
    tasksStore.releaseMove('a')
    adapters.notion.removeLanded.mockRejectedValueOnce(new CreateWaitingError())

    await expect(useTaskSync().commitTaskMove('a')).resolves.toBe('queued')
    expect(tasksStore.task('a')?.pendingMove?.fromCreateUncertain).toEqual(DOUBT)
    expect(handleErrorMock).not.toHaveBeenCalled()

    calls.length = 0
    await useTaskSync().syncPendingChanges('notion')
    expect(tasksStore.task('a')?.pendingMove).toBeUndefined()
    expect(calls).toEqual(['removeLanded:notion']) // the target page exists already: no second create
  })

  it('a failed lookup keeps the move queued with its doubt', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'local')
    tasksStore.releaseMove('a')
    adapters.notion.removeLanded.mockRejectedValueOnce(new CreateLookupError(Object.assign(new Error('Bad Gateway'), { statusCode: 502 })))
    await expect(useTaskSync().commitTaskMove('a')).resolves.toBe('queued')
    expect(tasksStore.task('a')?.pendingMove?.fromCreateUncertain).toEqual(DOUBT)
  })

  it('another doubt of the same title: nothing is archived, the move completes', async () => {
    tasksStore.setTasks([inDoubt('a'), inDoubt('rival')])
    move('a', 'local')
    tasksStore.releaseMove('a')
    await expect(useTaskSync().commitTaskMove('a')).resolves.toBe('committed')
    expect(adapters.notion.removeLanded).not.toHaveBeenCalled()
  })

  it('undo inside the window puts the task back with its doubt', () => {
    tasksStore.setTasks([inDoubt('a')])
    const previous = move('a', 'todoist')!
    tasksStore.restoreMoveOrigin('a', previous)
    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: null })
    expect(tasksStore.task('a')?.pendingSync?.createUncertain).toEqual(DOUBT)
    expect(tasksStore.task('a')?.pendingMove).toBeUndefined()
  })

  it('a rejected target create reverts with the doubt back on the marker', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'todoist')
    tasksStore.releaseMove('a')
    adapters.todoist.create.mockRejectedValueOnce(Object.assign(new Error('Bad request'), { statusCode: 400 }))

    await expect(useTaskSync().commitTaskMove('a')).resolves.toBe('reverted')

    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: null })
    expect(tasksStore.task('a')?.pendingSync?.createUncertain).toEqual(DOUBT)
    expect(adapters.notion.removeLanded).not.toHaveBeenCalled()
  })

  it('an undo after the task changed in the window keeps the doubt on the marker', () => {
    tasksStore.setTasks([inDoubt('a')])
    const previous = move('a', 'todoist')!
    tasksStore.markPendingSync('a') // a change inside the window
    tasksStore.restoreMoveOrigin('a', previous)
    expect(tasksStore.task('a')?.pendingSync?.createUncertain).toEqual(DOUBT)
  })

  it('a fetch between the move and the origin removal hands the page to the move: no card, the page is archived by id', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'todoist')
    tasksStore.releaseMove('a')

    tasksStore.mergeTasks('notion', [{ ...inDoubt('P'), externalId: 'P', pendingSync: undefined, createdAt: new Date('2026-11-19T10:00:05.000Z') }], { fetchStartedAt: T0, pushing: () => false })

    expect(tasksStore.tasks.map((t) => t.id)).toEqual(['a'])
    expect(tasksStore.task('a')?.pendingMove).toMatchObject({ fromExternalId: 'P' })
    expect(tasksStore.task('a')?.pendingMove?.fromCreateUncertain).toBeUndefined()

    await useTaskSync().commitTaskMove('a')
    expect(calls).toEqual(['create:todoist', 'remove:notion:P'])
    expect(adapters.notion.removeLanded).not.toHaveBeenCalled()
  })

  it('deleting a task whose move is outstanding settles the origin doubt too', async () => {
    tasksStore.setTasks([inDoubt('a')])
    move('a', 'todoist')
    tasksStore.releaseMove('a')
    const task = tasksStore.task('a')!
    tasksStore.addPendingDelete({ taskId: 'a', task, carryOver: null, state: 'queued', requestedAt: T0 })
    tasksStore.removeTask('a')

    await expect(useTaskSync().commitTaskDelete('a')).resolves.toBe('committed')
    expect(adapters.notion.removeLanded).toHaveBeenCalledTimes(1)
  })
})
