import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task = (overrides: Partial<Task>): Task => ({
  id: 'a', title: 'Rückruf', notes: null, status: TaskStatus.Open, priority: 1, activity: null, timeBoxSeconds: null,
  timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null, source: 'notion', externalId: null, ...overrides,
})

describe('tasksStore.markCreateUncertain (#528)', () => {
  let store: ReturnType<typeof useTasksStore>
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
    store.setTasks([task({}), task({ id: 'held', externalId: 'page-1' }), task({ id: 'l', source: 'local' })])
  })

  it('keeps the earliest time, the time of the last attempt and its title, and survives a failure record', () => {
    store.markPendingSync('a')
    store.markCreateUncertain('a', 2000, 'Rückruf')
    store.markCreateUncertain('a', 3000, 'Rückruf 2')
    store.recordPendingSyncFailure('a', 'timeout')
    expect(store.task('a')?.pendingSync?.createUncertain).toEqual({ since: 2000, at: 3000, title: 'Rückruf 2' })
  })

  it('is gone with the marker once the create is stored', () => {
    const revision = store.markPendingSync('a')
    store.markCreateUncertain('a', 2000, 'Rückruf')
    store.completeCreate('a', { externalId: 'page-9' }, revision)
    expect(store.task('a')?.pendingSync).toBeUndefined()
    expect(store.task('a')?.externalId).toBe('page-9')
  })

  it('sets nothing without a marker, on a task that has a page, or on a Local task', () => {
    store.markCreateUncertain('a', 2000, 'x')
    store.markPendingSync('held')
    store.markCreateUncertain('held', 2000, 'x')
    store.markCreateUncertain('l', 2000, 'x')
    expect(store.task('a')?.pendingSync).toBeUndefined()
    expect(store.task('held')?.pendingSync?.createUncertain).toBeUndefined()
    expect(store.task('l')?.pendingSync).toBeUndefined()
  })
})

describe('tasksStore.dropLandedDuplicates and completeCreate (#555)', () => {
  let store: ReturnType<typeof useTasksStore>
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
  })

  it('completeCreate drops the card a fetch made of the page meanwhile and keeps the waiting task', () => {
    store.setTasks([task({ id: 'a', status: TaskStatus.Progress, timeSpentSeconds: 30 })])
    const revision = store.markPendingSync('a')
    store.markCreateUncertain('a', 2000, 'Rückruf')
    // A fetch lands while the second attempt is in flight: the page shows up as a card of its own
    store.mergeTasks('notion', [task({ id: 'P', externalId: 'P' })], { pushing: (id) => id === 'a' })
    expect(store.tasks.map((t) => t.id).sort()).toEqual(['P', 'a'])

    store.completeCreate('a', { externalId: 'P' }, revision)

    expect(store.tasks.map((t) => t.id)).toEqual(['a'])
    expect(store.task('a')).toMatchObject({ externalId: 'P', status: TaskStatus.Progress, timeSpentSeconds: 30 })
    expect(store.task('a')?.pendingSync).toBeUndefined()
    // A later fetch of the same page matches the waiting task: still one card
    store.mergeTasks('notion', [task({ id: 'P', externalId: 'P' })])
    expect(store.tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('drops only cards of the same source with the same page, and never the excepted task', () => {
    store.setTasks([
      task({ id: 'a' }),
      task({ id: 'P', externalId: 'P' }),
      task({ id: 'Q', externalId: 'Q' }),
      task({ id: 'T', source: 'todoist', externalId: 'P' }),
      task({ id: 'l', source: 'local' }),
    ])
    expect(store.dropLandedDuplicates('notion', 'P', 'a')).toEqual(['P'])
    expect(store.tasks.map((t) => t.id).sort()).toEqual(['Q', 'T', 'a', 'l'])
    // A card that already holds the page and is the excepted task stays
    store.setTasks([task({ id: 'a', externalId: 'P' })])
    expect(store.dropLandedDuplicates('notion', 'P', 'a')).toEqual([])
    expect(store.tasks).toHaveLength(1)
  })

  it('keeps a same-title waiter a fetch handed the page to, with its notes and time (two creates in doubt)', () => {
    store.setTasks([
      task({ id: 'a', notes: null }),
      task({ id: 'b', notes: 'keep me', timeSpentSeconds: 900 }),
    ])
    const revisionA = store.markPendingSync('a')
    store.markPendingSync('b')
    store.markCreateUncertain('a', 2000, 'Rückruf')
    store.markCreateUncertain('b', 2000, 'Rückruf')
    // A's second attempt is in flight; the fetch hands page P to the other waiter, B
    store.mergeTasks('notion', [task({ id: 'P', externalId: 'P', createdAt: new Date(3000) })], { pushing: (id) => id === 'a' })
    expect(store.task('b')?.externalId).toBe('P')

    // A's lookup resolves with the same page: B must not be dropped as a stray
    expect(store.completeCreate('a', { externalId: 'P' }, revisionA)).toEqual([])

    expect(store.task('b')).toMatchObject({ externalId: 'P', notes: 'keep me', timeSpentSeconds: 900 })
    expect(store.task('b')?.pendingSync).toBeDefined()
    expect(store.task('a')?.externalId).toBe('P')
  })

  it('keeps a card that holds queued local changes and drops the one that holds none', () => {
    store.setTasks([
      task({ id: 'edited', externalId: 'P', pendingSync: { since: 1, attempts: 0, lastError: null } }),
      task({ id: 'timed', externalId: 'P' }),
      task({ id: 'stray', externalId: 'P' }),
    ])
    store.addTrackedSeconds('timed', 30)
    expect(store.dropLandedDuplicates('notion', 'P')).toEqual(['stray'])
    expect(store.tasks.map((t) => t.id).sort()).toEqual(['edited', 'timed'])
  })

  it('matches nothing for Local or a missing page', () => {
    store.setTasks([task({ id: 'l', source: 'local' }), task({ id: 'a' })])
    expect(store.dropLandedDuplicates('local', null)).toEqual([])
    expect(store.dropLandedDuplicates('notion', null)).toEqual([])
    expect(store.tasks).toHaveLength(2)
  })

  it('leaves deletedTaskIds, the trash and pending deletes alone', () => {
    store.setTasks([task({ id: 'P', externalId: 'P' })])
    store.deletedTaskIds.push('X')
    store.dropLandedDuplicates('notion', 'P', 'a')
    expect(store.deletedTaskIds).toEqual(['X'])
    expect(store.pendingDeletes).toEqual({})
  })
})
