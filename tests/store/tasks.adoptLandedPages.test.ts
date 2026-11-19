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

  describe('a page is handed to a delete or a move origin only when no rival doubt could own it (#535)', () => {
    const doubtOf = (since: number, title = 'Rückruf') => ({ since: 1, attempts: 1, lastError: 'timeout', createUncertain: { since, at: since, title } })
    const deleted = (since: number, title = 'Rückruf') => ({
      taskId: 'gone', task: task({ id: 'gone', title, pendingSync: doubtOf(since, title) }), carryOver: null, state: 'queued' as const, requestedAt: 1,
    })

    it('leaves the page alone when a card holds a doubt of the same title: no delete takes it, the card does', () => {
      store.setTasks([waiting()])
      store.addPendingDelete(deleted(SINCE - 5000))
      store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')])
      expect(store.pendingDeletes.gone?.task.externalId).toBeNull()
      expect(store.deletedTaskIds).not.toContain('P')
      expect(store.task('a')?.externalId).toBe('P')
    })

    it('leaves the page alone when a trash entry holds a doubt of the same title: the page comes back as a card', async () => {
      const { useTrashStore } = await import('~/store/trash')
      const trash = useTrashStore()
      trash.add({ taskId: 't', task: task({ id: 't' }), fromStatus: TaskStatus.Open, deletedAt: Date.now(), carryOver: null, createUncertain: { since: SINCE, at: SINCE, title: 'Rückruf' } } as never)
      store.addPendingDelete(deleted(SINCE))
      store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')])
      expect(store.pendingDeletes.gone?.task.externalId).toBeNull()
      expect(store.deletedTaskIds).not.toContain('P')
    })

    it('leaves the page alone when a card\'s move origin holds a doubt of the same title', () => {
      store.setTasks([task({ id: 'mv', source: 'todoist', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: null, toSource: 'todoist', fromCreateUncertain: { since: SINCE, at: SINCE, title: 'Rückruf' } } })])
      store.addPendingDelete(deleted(SINCE))
      store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')])
      expect(store.pendingDeletes.gone?.task.externalId).toBeNull()
      expect(store.task('mv')?.pendingMove?.fromExternalId).toBeNull()
      expect(store.deletedTaskIds).not.toContain('P')
    })

    it('leaves the page alone when a delete and a move origin of the same title compete', () => {
      store.setTasks([task({ id: 'mv', source: 'todoist', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: null, toSource: 'todoist', fromCreateUncertain: { since: SINCE, at: SINCE, title: 'Rückruf' } } })])
      store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')])
      expect(store.task('mv')?.pendingMove?.fromExternalId).toBe('P') // alone, the origin takes it (control)
      store.setTasks([task({ id: 'mv2', source: 'todoist', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: null, toSource: 'todoist', fromCreateUncertain: { since: SINCE, at: SINCE, title: 'Rückruf' } } })])
      store.addPendingDelete(deleted(SINCE))
      store.mergeTasks('notion', [page('Q', 'Rückruf', '2026-11-19T10:00:05.000Z')])
      expect(store.task('mv2')?.pendingMove?.fromExternalId).toBeNull()
      expect(store.pendingDeletes.gone?.task.externalId).toBeNull()
    })

    it('still hands the page over when the title is not shared (control)', () => {
      store.setTasks([waiting({ title: 'Anderes', pendingSync: doubtOf(SINCE, 'Anderes') })])
      store.addPendingDelete(deleted(SINCE))
      store.mergeTasks('notion', [page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')])
      expect(store.pendingDeletes.gone?.task.externalId).toBe('P')
      expect(store.deletedTaskIds).toContain('P')
    })
  })

  describe('a trash entry whose restore create is in doubt takes the landed page (#545)', () => {
    const entryOf = (overrides: Record<string, unknown> = {}) => ({
      taskId: 't', task: task({ id: 't', externalId: 'old' }), fromStatus: TaskStatus.Waiting, deletedAt: Date.now(), carryOver: null,
      createUncertain: { since: SINCE, at: SINCE, title: 'Rückruf' }, ...overrides,
    })
    const withEntry = async (overrides: Record<string, unknown> = {}) => {
      const { useTrashStore } = await import('~/store/trash')
      const trash = useTrashStore()
      trash.add(entryOf(overrides) as never)
      return trash
    }
    const landed = () => page('P', 'Rückruf', '2026-11-19T10:00:05.000Z')

    it('hands the page to the entry: no card, the doubt gone, the page hidden and archived by a queued delete', async () => {
      const trash = await withEntry()
      store.mergeTasks('notion', [landed()])
      expect(store.tasks).toHaveLength(0)
      expect(trash.entry('t')?.createUncertain).toBeUndefined()
      expect(trash.entry('t')?.task.externalId).toBe('P')
      expect(store.deletedTaskIds).toContain('P')
      expect(store.pendingDeletes.t).toMatchObject({ taskId: 't', state: 'queued', fromStatus: TaskStatus.Waiting, task: { externalId: 'P' } })
      // A later fetch keeps the page off the board too
      store.mergeTasks('notion', [landed()])
      expect(store.tasks).toHaveLength(0)
    })

    it('the queued delete carries no old pendingSync or pendingMove of the deleted task (a restore would copy them back)', async () => {
      const trash = await withEntry({
        task: task({
          id: 't', externalId: 'old',
          pendingSync: { since: SINCE, attempts: 1, lastError: 'x' },
          pendingMove: { fromSource: 'todoist', fromExternalId: 'orig', toSource: 'notion' },
        }),
      })
      store.mergeTasks('notion', [landed()])
      const queued = store.pendingDeletes.t
      expect(queued?.task.externalId).toBe('P')
      expect(queued?.task.pendingSync).toBeUndefined()
      expect(queued?.task.pendingMove).toBeUndefined()
      // The entry keeps its snapshot; only the delete is cleaned
      expect(trash.entry('t')?.task.externalId).toBe('P')
    })

    it('leaves the page as a card when its title, age or holder does not fit', async () => {
      const trash = await withEntry()
      store.mergeTasks('notion', [page('A', 'Anderes', '2026-11-19T10:00:05.000Z'), page('B', 'Rückruf', '2026-11-19T08:00:00.000Z')])
      expect(store.tasks.map(el => el.id).sort()).toEqual(['A', 'B'])
      expect(trash.entry('t')?.createUncertain).toBeDefined()
      expect(store.pendingDeletes.t).toBeUndefined()
    })

    it('skips an entry whose restore is in flight', async () => {
      const trash = await withEntry()
      store.mergeTasks('notion', [landed()], { pushing: (id) => id === 't' })
      expect(store.task('P')).not.toBeNull()
      expect(trash.entry('t')?.createUncertain).toBeDefined()
      expect(store.pendingDeletes.t).toBeUndefined()
    })

    it('leaves the page alone when a rival doubt of the same title exists (it may be the rival\'s)', async () => {
      const trash = await withEntry()
      store.setTasks([waiting()])
      store.mergeTasks('notion', [landed()])
      expect(store.task('a')?.externalId).toBe('P') // the waiting card takes it, the entry does not
      expect(trash.entry('t')?.createUncertain).toBeDefined()
      expect(store.pendingDeletes.t).toBeUndefined()
    })

    it('only an entry of the fetched source takes a page, and a page only once (the oldest doubt first)', async () => {
      const trash = await withEntry({ task: task({ id: 't', source: 'todoist', externalId: 'old' }) })
      store.mergeTasks('notion', [landed()])
      expect(store.task('P')).not.toBeNull()
      expect(trash.entry('t')?.createUncertain).toBeDefined()
    })

    it('a pending delete of the same task already exists: the entry waits', async () => {
      const trash = await withEntry()
      store.addPendingDelete({ taskId: 't', task: task({ id: 't', externalId: 'old' }), carryOver: null, state: 'queued', requestedAt: 1 })
      store.mergeTasks('notion', [landed()])
      expect(trash.entry('t')?.createUncertain).toBeDefined()
      expect(store.pendingDeletes.t?.task.externalId).toBe('old')
    })
  })
})
