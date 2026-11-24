/**
 * #781: a push of a done Todoist task for any reason other than its completion (a field edit, a done day, a time edit,
 * a retry after the completion landed, a status write queued behind another push) never closes it a second time: a
 * recurring task would skip an occurrence. The task's `pendingSync.upstreamDone` is the one record of what Todoist
 * holds, and `TodoistSource` writes only a change of the done state. Sequences through the real adapter and
 * integration; only the SDK is replaced and counts the requests that went through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { switchSource, sourceOf } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), setCompletionDate: vi.fn(() => true),
    syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn(),
  }),
}))

// While `unreachable`, every request fails like a lost connection; `failing` makes one named request fail once.
const sdkCalls: string[] = []
let unreachable = false
const failing = new Set<string>()
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function () {
    const request = (name: string) => async (id: string) => {
      if (unreachable) throw new Error('Failed to fetch')
      if (failing.delete(`${name}:${id}`)) throw new Error('HTTP 500')
      sdkCalls.push(`${name}:${id}`)
      return true
    }
    return {
      closeTask: request('close'),
      reopenTask: request('reopen'),
      deleteTask: request('delete'),
      getProjects: async () => ({ results: [] }),
      addTask: async () => {
        if (unreachable) throw new Error('Failed to fetch')
        sdkCalls.push('add:td-new')
        return { id: 'td-new' }
      },
    }
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
import { normalizeTasks } from '~/lib/taskSources'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
/* eslint-enable import/first */

const task = (id: string, status: TaskStatus): Task => ({
  id, ...sourceOf(id), title: id, notes: null, status, priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0,
  topicColorCode: null, topic: null, timerId: null, activity: null, createdAt: new Date('2026-01-01T00:00:00Z'),
  ...(status === TaskStatus.Done ? { completedAt: new Date() } : {}),
})
const addTask = (id: string, status: TaskStatus) => useTasksStore().addTask(task(id, status))
const setToken = (token: string | null) => { useBoardStore().boardConfig.todoistApiToken = token as string }

/** The local day before today, `YYYY-MM-DD`. */
function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Waits until the pushes of the task have settled (`void`-started pushes are not awaited by their caller). */
async function settled(taskId: string): Promise<void> {
  await vi.waitFor(() => expect(useTaskSync().isPushing(taskId)).toBe(false))
}

describe('Todoist: a done task is never closed a second time (#781)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    sdkCalls.length = 0
    unreachable = false
    failing.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    switchSource('todoist')
    setToken('token')
  })
  afterEach(() => vi.restoreAllMocks())

  it('a priority and a time box edit of a done task send nothing', async () => {
    addTask('t1', TaskStatus.Done)
    const { editTask } = useTaskSync()
    expect(await editTask('t1', { priority: 3 })).toBe(true)
    expect(await editTask('t1', { timeBoxSeconds: 1800 })).toBe(true)
    expect(sdkCalls).toEqual([])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('a done-day correction and a time-spent edit of a done task send nothing', async () => {
    addTask('t1', TaskStatus.Done)
    const sync = useTaskSync()
    expect(sync.setCompletedDay('t1', yesterday())).not.toBeNull()
    await settled('t1')
    useTasksStore().setTimeSpent('t1', 600)
    await sync.syncTaskToIntegration(useTasksStore().task('t1')!)
    expect(sdkCalls).toEqual([])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('the tick sends one close and leaving Done one reopen; edits in between send nothing', async () => {
    addTask('t1', TaskStatus.Open)
    const sync = useTaskSync()
    await sync.updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await sync.editTask('t1', { priority: 3 })
    await sync.updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await sync.editTask('t1', { priority: 2 })
    expect(sdkCalls).toEqual(['close:t1', 'reopen:t1'])
  })

  it('a failed tick, then an edit while still unreachable, then the retry: closed exactly once', async () => {
    addTask('t1', TaskStatus.Open)
    const sync = useTaskSync()
    unreachable = true
    await sync.updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await sync.editTask('t1', { priority: 3 })
    expect(useTasksStore().task('t1')?.pendingSync?.upstreamDone).toBe(false)

    unreachable = false
    await sync.syncPendingChanges()
    await sync.editTask('t1', { priority: 2 })
    await sync.syncPendingChanges()
    expect(sdkCalls).toEqual(['close:t1'])
  })

  it('a failed tick, then an edit once reachable: the edit sends the close, the retry nothing more', async () => {
    addTask('t1', TaskStatus.Open)
    const sync = useTaskSync()
    failing.add('close:t1')
    await sync.updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await sync.editTask('t1', { priority: 3 })
    await sync.syncPendingChanges()
    expect(sdkCalls).toEqual(['close:t1'])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('no token: the edit of a done task fails and keeps its marker; the retry with the token sends no close', async () => {
    addTask('t1', TaskStatus.Done)
    const sync = useTaskSync()
    setToken(null)
    expect(await sync.editTask('t1', { priority: 3 })).toBe(false)
    expect(useTasksStore().task('t1')?.pendingSync).toMatchObject({ upstreamDone: true, attempts: 1 })

    setToken('token')
    await sync.syncPendingChanges()
    expect(sdkCalls).toEqual([])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('a tick queued behind another push (a done-day change) closes once in total', async () => {
    addTask('t1', TaskStatus.Open)
    const sync = useTaskSync()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    // A stack drop chains its writes: this one waits for the gate, the status is local at once
    const tick = sync.updateTaskStatus({ taskId: 't1', status: TaskStatus.Done, after: gate })
    expect(sync.setCompletedDay('t1', yesterday())).not.toBeNull()
    await vi.waitFor(() => expect(sdkCalls).toEqual(['close:t1']))
    await vi.waitFor(() => expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined())

    release()
    await tick
    expect(sdkCalls).toEqual(['close:t1'])
  })

  it('a restore of a done task whose completion fails is completed once by the next push', async () => {
    const done = task('t1', TaskStatus.Done)
    useTrashStore().add({ taskId: 't1', task: done, deletedAt: Date.now(), fromStatus: TaskStatus.Done, carryOver: null as never })
    failing.add('close:td-new')
    const sync = useTaskSync()

    await sync.restoreTask(useTrashStore().entry('t1')!)
    expect(useTasksStore().task('t1')).toMatchObject({ status: TaskStatus.Done, externalId: 'td-new', pendingSync: { upstreamDone: false } })
    expect(sdkCalls).toEqual(['add:td-new'])

    await sync.syncPendingChanges()
    await sync.syncPendingChanges()
    expect(sdkCalls).toEqual(['add:td-new', 'close:td-new'])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('a restore of a done task whose completion lands carries no marker, and an edit after it sends nothing', async () => {
    const done = task('t1', TaskStatus.Done)
    useTrashStore().add({ taskId: 't1', task: done, deletedAt: Date.now(), fromStatus: TaskStatus.Done, carryOver: null as never })
    const sync = useTaskSync()

    await sync.restoreTask(useTrashStore().entry('t1')!)
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
    await sync.editTask('t1', { priority: 3 })
    expect(sdkCalls).toEqual(['add:td-new', 'close:td-new'])
  })

  it('a marker stored before #344 (no upstreamDone) on a done task sends the close once more', async () => {
    const legacy = { ...task('t1', TaskStatus.Done), pendingSync: { since: 1, attempts: 2, lastError: 'Failed to fetch' } }
    useTasksStore().setTasks(normalizeTasks([JSON.parse(JSON.stringify(legacy))], 'todoist'))
    expect(useTasksStore().task('t1')?.pendingSync?.upstreamDone).toBeUndefined()

    const sync = useTaskSync()
    await sync.syncPendingChanges()
    await sync.editTask('t1', { priority: 3 })
    await sync.syncPendingChanges()
    expect(sdkCalls).toEqual(['close:t1'])
  })

  it('a tick inside a move\'s undo window, then Undo: the next push closes the task once', async () => {
    addTask('t1', TaskStatus.Open)
    const store = useTasksStore()
    const sync = useTaskSync()
    // What `useTaskMove` does: the move is local at once and held for the toast; Undo puts it back
    const previous = store.reassignSource('t1', 'local')!
    store.holdMove('t1')
    await sync.updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    store.releaseMove('t1')
    store.restoreMoveOrigin('t1', previous)
    expect(store.task('t1')).toMatchObject({ source: 'todoist', externalId: 't1', pendingSync: { upstreamDone: false } })

    await sync.syncPendingChanges()
    await sync.editTask('t1', { priority: 3 })
    await sync.syncPendingChanges()
    expect(sdkCalls).toEqual(['close:t1'])
    expect(store.task('t1')?.pendingSync).toBeUndefined()
  })
})
