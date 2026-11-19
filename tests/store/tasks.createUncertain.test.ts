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
