/**
 * #390: a fetch that began before a task's write went through is older than that write, so a task the list
 * does contain keeps its local state too (not only a task the list lacks, #357): the next fetch decides.
 * #392: a held task a list read in parts lacks is dropped only when two lists in a row lack it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { isNotPlanned } from '~/lib/taskPlanning'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const source = overrides.source ?? 'notion'
  return {
    id, source, externalId: source === 'local' ? null : id, title: `Task ${id}`, status: TaskStatus.Open, activity: null,
    topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
    ...overrides,
  }
}

const T0 = new Date('2026-11-16T09:00:00Z').getTime()

describe('a list read before a task was written does not overwrite the task (#390)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  /** A push of the task went through at `at`: what `useTaskSync` does to the store around a write */
  const pushed = (store: ReturnType<typeof useTasksStore>, id: string, at: number) => {
    vi.setSystemTime(at - 100)
    const revision = store.markPendingSync(id)
    vi.setSystemTime(at)
    store.clearPendingSync(id, revision)
  }

  it('a status the push wrote stays when the older list still carries the old one', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { status: TaskStatus.Progress, title: 'Lokal' })])
    pushed(store, 't', T0 + 500)
    store.mergeTasks('notion', [makeTask('t', { status: TaskStatus.Open, title: 'Alt' })], { fetchStartedAt: T0 })
    expect(store.task('t')).toMatchObject({ status: TaskStatus.Progress, title: 'Lokal' })
    expect(store.task('t')!.pendingSync).toBeUndefined()
  })

  it('a plan the push wrote stays when the older list still holds the page as not planned', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { notPlanned: true, sourceNotPlanned: 'Backlog' })])
    vi.setSystemTime(T0 + 300)
    store.planTasks(['t'])
    store.setSourceNotPlanned('t', undefined)
    const revision = store.markPendingSync('t')
    vi.setSystemTime(T0 + 600)
    store.clearPendingSync('t', revision)
    store.mergeTasks('notion', [makeTask('t', { sourceNotPlanned: 'Backlog' })], { fetchStartedAt: T0 })
    expect(isNotPlanned(store.task('t')!)).toBe(false)
    expect(store.task('t')!.sourceNotPlanned).toBeUndefined()
    expect(store.tasksOpen.map(t => t.id)).toEqual(['t'])
  })

  it('a write still under way keeps the task, however long ago it began', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { status: TaskStatus.Progress })])
    vi.setSystemTime(T0 + 5000)
    store.mergeTasks('notion', [makeTask('t')], { fetchStartedAt: T0 + 4000, pushing: id => id === 't' })
    expect(store.task('t')!.status).toBe(TaskStatus.Progress)
  })

  it('the next list, read after the write, says what the source holds', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { status: TaskStatus.Progress })])
    pushed(store, 't', T0 + 500)
    store.mergeTasks('notion', [makeTask('t')], { fetchStartedAt: T0 })
    expect(store.task('t')!.status).toBe(TaskStatus.Progress)
    // a list read after the write says what the source holds now
    store.mergeTasks('notion', [makeTask('t', { status: TaskStatus.Done })], { fetchStartedAt: T0 + 1000 })
    expect(store.task('t')!.status).toBe(TaskStatus.Done)
  })

  it('a write that ended in the millisecond the fetch began was there before its first read', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { status: TaskStatus.Progress })])
    pushed(store, 't', T0)
    store.mergeTasks('notion', [makeTask('t', { status: TaskStatus.Done })], { fetchStartedAt: T0 })
    expect(store.task('t')!.status).toBe(TaskStatus.Done)
  })

  it('a task nobody wrote follows the list, and so does a list without the options', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { status: TaskStatus.Progress }), makeTask('u', { status: TaskStatus.Progress })])
    pushed(store, 'u', T0 + 500)
    store.mergeTasks('notion', [makeTask('t', { status: TaskStatus.Done }), makeTask('u')], { fetchStartedAt: T0 })
    expect(store.task('t')!.status).toBe(TaskStatus.Done)
    expect(store.task('u')!.status).toBe(TaskStatus.Progress)
    store.mergeTasks('notion', [makeTask('t', { status: TaskStatus.Done }), makeTask('u')])
    expect(store.task('u')!.status).toBe(TaskStatus.Open)
  })

  it('a Local task has no upstream and is never held', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('l', { source: 'local', status: TaskStatus.Progress })])
    pushed(store, 'l', T0 + 500)
    store.mergeTasks('local', [makeTask('l', { source: 'local', status: TaskStatus.Done })], { fetchStartedAt: T0 })
    expect(store.task('l')!.status).toBe(TaskStatus.Done)
  })
})

describe('a task a list lacks goes only when two lists in a row lack it (#392)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  const PARTS = { readInParts: true }
  const seed = () => {
    const store = useTasksStore()
    store.setTasks([makeTask('other'), makeTask('moved', { timeSpentSeconds: 900 })])
    return store
  }

  it('a list read in parts keeps a task it lacks once and drops it at the second', () => {
    const store = seed()
    store.mergeTasks('notion', [makeTask('other')], PARTS)
    expect(store.task('moved')).toMatchObject({ timeSpentSeconds: 900 })
    store.mergeTasks('notion', [makeTask('other')], PARTS)
    expect(store.task('moved')).toBeNull()
  })

  it('a list that has the task in between starts over', () => {
    const store = seed()
    store.mergeTasks('notion', [makeTask('other')], PARTS)
    store.mergeTasks('notion', [makeTask('other'), makeTask('moved', { status: TaskStatus.Progress })], PARTS)
    expect(store.task('moved')).toMatchObject({ status: TaskStatus.Progress, timeSpentSeconds: 900 })
    store.mergeTasks('notion', [makeTask('other')], PARTS)
    expect(store.task('moved')).not.toBeNull()
    store.mergeTasks('notion', [makeTask('other')], PARTS)
    expect(store.task('moved')).toBeNull()
  })

  it('a list read at once drops a task it lacks at the first merge, as before', () => {
    const store = seed()
    store.mergeTasks('notion', [makeTask('other')])
    expect(store.task('moved')).toBeNull()
  })

  it('the record is per source: another source\'s merge neither clears nor spends it', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('n', {}), makeTask('t', { source: 'todoist' })])
    store.mergeTasks('notion', [], PARTS)
    store.mergeTasks('todoist', [makeTask('t', { source: 'todoist' })])
    expect(store.task('n')).not.toBeNull()
    store.mergeTasks('notion', [], PARTS)
    expect(store.task('n')).toBeNull()
  })

  it('a task kept because it was written since the fetch began is kept once: a push that keeps failing does not outlive the syncs', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('other'), makeTask('gone')])
    // every tick the push starts with the fetch and fails after it
    vi.setSystemTime(T0 + 300)
    store.markPendingSync('gone')
    store.recordPendingSyncFailure('gone', 'object_not_found')
    store.mergeTasks('notion', [makeTask('other')], { fetchStartedAt: T0 })
    expect(store.task('gone')).not.toBeNull()
    vi.setSystemTime(T0 + 300_000 + 300)
    store.recordPendingSyncFailure('gone', 'object_not_found')
    store.mergeTasks('notion', [makeTask('other')], { fetchStartedAt: T0 + 300_000 })
    expect(store.task('gone')).toBeNull()
  })

  it('the capped list\'s own rule is unchanged: a held task past the cap and a task with unpushed changes stay', () => {
    const store = useTasksStore()
    store.setTasks([
      makeTask('other'),
      makeTask('past-cap', { notPlanned: true, sourceNotPlanned: 'Backlog' }),
      makeTask('edited', { pendingSync: { since: T0, attempts: 0, lastError: null } }),
    ])
    for (let i = 0; i < 3; i++) store.mergeTasks('notion', [makeTask('other')], { partialNotPlanned: ['Backlog'], readInParts: true })
    expect(store.tasks.map(t => t.id).sort()).toEqual(['edited', 'other', 'past-cap'])
  })

  it('a task made while the source was unreachable stays until it is created', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('other'), makeTask('new', { externalId: null, pendingSync: { since: T0, attempts: 1, lastError: 'offline' } })])
    for (let i = 0; i < 3; i++) store.mergeTasks('notion', [makeTask('other')], PARTS)
    expect(store.task('new')).not.toBeNull()
  })
})
