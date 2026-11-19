/**
 * #528 (review, high): a fetch that returns the page an unknown-outcome create made must not add it as a second card.
 * `mergeTasks` hands the page to the never-created task that waits for it (same title, created since its doubt, not
 * held by anything else); the next push then updates that page instead of creating another.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const SINCE = Date.parse('2026-11-19T10:00:00.000Z')

const task = (overrides: Partial<Task>): Task => ({
  id: 'a', title: 'Rückruf', notes: null, status: TaskStatus.Open, priority: 1, activity: null, timeBoxSeconds: null,
  timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null, source: 'notion', externalId: null, ...overrides,
})
const waiting = (overrides: Partial<Task> = {}): Task =>
  task({ pendingSync: { since: 1, attempts: 1, lastError: 'timeout', createUncertain: { since: SINCE, at: SINCE, title: 'Rückruf' } }, ...overrides })
const page = (id: string, title: string, createdAt: string): Task =>
  task({ id, externalId: id, title, createdAt: new Date(createdAt) })

describe('mergeTasks hands a landed page to the task that waits for it (#528)', () => {
  let store: ReturnType<typeof useTasksStore>
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
  })

  it('adopts the page: no second card, the task keeps its id and its marker (without the doubt)', () => {
    store.setTasks([waiting()])
    store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')])
    expect(store.tasks).toHaveLength(1)
    expect(store.task('a')).toMatchObject({ id: 'a', externalId: 'P' })
    expect(store.task('a')?.pendingSync).toBeDefined() // the next push writes the task's current state
    expect(store.task('a')?.pendingSync?.createUncertain).toBeUndefined()
  })

  it('leaves a page with another title, one made long before the doubt, or one held by another card as a card of its own', () => {
    store.setTasks([waiting(), task({ id: 'held', externalId: 'H', title: 'Rückruf' })])
    store.mergeTasks('notion', [
      page('H', 'Rückruf', '2026-11-19T10:00:05.000Z'),
      page('other', 'Anderes', '2026-11-19T10:00:05.000Z'),
      page('old', 'Rückruf', '2026-11-19T09:00:00.000Z'),
    ])
    expect(store.task('a')?.externalId).toBeNull()
    expect(store.tasks.map((t) => t.id).sort()).toEqual(['a', 'held', 'old', 'other'].sort())
  })

  it('does not adopt a page a pending delete, a pending move origin or the trash still holds', () => {
    store.setTasks([waiting(), task({ id: 'mv', source: 'todoist', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: 'M', toSource: 'todoist' } })])
    store.addPendingDelete({
      taskId: 'gone', task: task({ id: 'gone', externalId: 'D' }), carryOver: null, state: 'queued', requestedAt: 1,
    })
    store.mergeTasks('notion', [
      page('D', 'Rückruf', '2026-11-19T10:00:05.000Z'),
      page('M', 'Rückruf', '2026-11-19T10:00:06.000Z'),
    ])
    expect(store.task('a')?.externalId).toBeNull()
  })

  it('adopts the oldest of two matching pages, and a page only once', () => {
    store.setTasks([waiting(), waiting({ id: 'b' })])
    store.mergeTasks('notion', [
      page('P2', 'Rückruf', '2026-11-19T10:00:09.000Z'),
      page('P1', 'Rückruf', '2026-11-19T10:00:05.000Z'),
    ])
    expect([store.task('a')?.externalId, store.task('b')?.externalId].sort()).toEqual(['P1', 'P2'])
    expect(store.tasks).toHaveLength(2)
  })

  it('skips a task whose push is under way', () => {
    store.setTasks([waiting()])
    store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')], { pushing: (id) => id === 'a' })
    expect(store.task('a')?.externalId).toBeNull()
  })

  it('a page without a creation time is never adopted', () => {
    store.setTasks([waiting()])
    store.mergeTasks('notion', [{ ...page('P', 'Rückruf', '2026-11-19T10:00:05.000Z'), createdAt: null }])
    expect(store.task('a')?.externalId).toBeNull()
  })
})
