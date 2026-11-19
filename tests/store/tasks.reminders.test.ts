/**
 * #551: how `mergeTasks` treats a Reminders task. `Task.reminders` is replaced by every fetch unless a push is outstanding,
 * kan-do's own time box, priority, ad-hoc marker and time spent stay (a reminder carries none), a recurring occurrence is
 * its own task by `externalId`, and a Reminders task is delivered without a planning state (it starts Offen).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { isNotPlanned } from '~/lib/taskPlanning'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const reminder = (externalId: string, overrides: Partial<Task> = {}): Task => ({
  id: externalId, source: 'reminders', externalId, title: `Reminder ${externalId}`, status: TaskStatus.Open, activity: null, topic: 'Zuhause',
  topicColorCode: null, priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, isUnplanned: false,
  reminders: { due: { date: '2026-11-19', time: null }, recurrence: null, listId: 'L1' }, ...overrides,
})
/** How the integration manager merges a Reminders fetch (`RemindersSource.holdsOnlyOpenDone`, `keepsKanDoFields`) */
const REMINDERS = { holdsOnlyOpenDone: true, keepsKanDoFields: true }

describe('mergeTasks of a Reminders task (#551)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a task seen for the first time starts Offen on the board, never not planned', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    expect(store.task('a')).toMatchObject({ source: 'reminders', externalId: 'a', status: TaskStatus.Open })
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a'])
  })

  it('the fetched Task.reminders replaces the stored one on every fetch', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    store.mergeTasks('reminders', [reminder('a', { reminders: { due: { date: '2026-11-25', time: '09:00' }, recurrence: 'FREQ=WEEKLY', listId: 'L2' }, title: 'Renamed in Reminders' })], REMINDERS)
    expect(store.task('a')!.reminders).toEqual({ due: { date: '2026-11-25', time: '09:00' }, recurrence: 'FREQ=WEEKLY', listId: 'L2' })
    expect(store.task('a')!.title).toBe('Renamed in Reminders')
  })

  it('kan-do keeps its own time box, priority, ad-hoc marker and time spent over a fetch of defaults', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    store.updateTask('a', { timeBoxSeconds: 1500, priority: 3, isUnplanned: true, timeSpentSeconds: 600 })
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    expect(store.task('a')).toMatchObject({ timeBoxSeconds: 1500, priority: 3, isUnplanned: true, timeSpentSeconds: 600 })
  })

  it('a task with an outstanding push keeps its local state, Task.reminders included', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    store.updateTask('a', { status: TaskStatus.Done })
    store.markPendingSync('a', false)
    store.mergeTasks('reminders', [reminder('a', { reminders: { due: { date: '2026-12-01', time: null }, recurrence: null, listId: 'L1' } })], REMINDERS)
    expect(store.task('a')!.status).toBe(TaskStatus.Done)
    expect(store.task('a')!.reminders?.due?.date).toBe('2026-11-19')
  })

  it('Jetzt and Wartet are kan-do\'s: Reminders reports open and the column stays', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a'), reminder('b')], REMINDERS)
    store.updateTask('a', { status: TaskStatus.Progress })
    store.updateTask('b', { status: TaskStatus.Waiting })
    store.mergeTasks('reminders', [reminder('a'), reminder('b')], REMINDERS)
    expect(store.task('a')!.status).toBe(TaskStatus.Progress)
    expect(store.task('b')!.status).toBe(TaskStatus.Waiting)
  })

  it('done follows both ways: done in Reminders, then reopened there', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    store.mergeTasks('reminders', [reminder('a', { status: TaskStatus.Done, completedAt: new Date(2026, 10, 19, 10) })], REMINDERS)
    expect(store.task('a')!.status).toBe(TaskStatus.Done)
    store.mergeTasks('reminders', [reminder('a')], REMINDERS)
    expect(store.task('a')!.status).toBe(TaskStatus.Open)
  })

  it('every occurrence of a recurring reminder is its own card: the done one stays, the next arrives new', () => {
    const store = useTasksStore()
    const recurring = (date: string, over: Partial<Task> = {}) => reminder(`ABC@${date}`, { reminders: { due: { date, time: null }, recurrence: 'FREQ=DAILY', listId: 'L1' }, ...over })
    store.mergeTasks('reminders', [recurring('2026-11-19')], REMINDERS)
    // Ticked: the adapter hands the occurrence back as Done (its ledger) beside the next date
    store.mergeTasks('reminders', [recurring('2026-11-19', { status: TaskStatus.Done, completedAt: new Date() }), recurring('2026-11-20')], REMINDERS)
    expect(store.tasks.map(t => [t.externalId, t.status])).toEqual([['ABC@2026-11-19', TaskStatus.Done], ['ABC@2026-11-20', TaskStatus.Open]])
  })

  it('a task gone at its source (list switched off or gone) ends at the next sync; another source is untouched', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [reminder('a'), reminder('b')], REMINDERS)
    store.mergeTasks('local', [{ ...reminder('l'), source: 'local', externalId: null, reminders: undefined }])
    store.mergeTasks('reminders', [reminder('b')], REMINDERS)
    expect(store.tasks.map(t => t.id).sort()).toEqual(['b', 'l'])
  })
})
