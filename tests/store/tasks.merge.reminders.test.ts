/**
 * #553: how `mergeTasks` treats a source that plans by date (`planningByDate`, Apple Reminders). The adapter delivers
 * `sourceNotPlanned = 'not-today'` for a date that is not today (or today before the day has begun); the merge moves a task
 * only when that presence changes, never takes a planned card off the board, and keeps the date the user's plan wrote.
 * One test per row of the merge matrix in the issue.
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

const TODAY = '2026-11-19'
const BY_DATE = { holdsOnlyOpenDone: true, keepsKanDoFields: true, planningByDate: true }

/** What `RemindersSource.fetchActive` delivers for a reminder: not-today unless it is dated today and the day has begun. */
const delivered = (id: string, date: string | null, opts: { begun?: boolean; recurrence?: string | null; title?: string; time?: string | null } = {}): Task => ({
  id, source: 'reminders', externalId: id, title: opts.title ?? `Reminder ${id}`, status: TaskStatus.Open, activity: null, topic: 'Zuhause',
  topicColorCode: null, priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, isUnplanned: false,
  reminders: { due: date ? { date, time: opts.time ?? null } : null, recurrence: opts.recurrence ?? null, listId: 'L1' },
  ...(date === TODAY && opts.begun !== false ? {} : { sourceNotPlanned: 'not-today' }),
})

describe('mergeTasks of a source that plans by date (#553)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a new task dated today is planned (Offen) once the day has begun, nothing written', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a'])
    expect(store.task('a')!.pendingSync).toBeUndefined()
  })

  it('a new task dated today waits in "Alle Aufgaben" while the day has not begun, and joins at the first fetch after it', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY, { begun: false })], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    store.mergeTasks('reminders', [delivered('a', TODAY, { begun: false })], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a'])
  })

  it('a new task dated in the past, the future or not at all lands in "Alle Aufgaben"', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('past', '2026-11-18'), delivered('future', '2026-11-25'), delivered('none', null)], BY_DATE)
    expect(['past', 'future', 'none'].map(id => isNotPlanned(store.task(id)!))).toEqual([true, true, true])
    expect(store.tasksOpen).toEqual([])
  })

  it('a task in "Alle Aufgaben" whose date becomes today is planned, nothing written', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', '2026-11-25')], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
    expect(store.task('a')!.pendingSync).toBeUndefined()
  })

  it('a task the user put back while Reminders still says today stays in "Alle Aufgaben" through every sync', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    expect(store.unplanTask('a')).toBe(true)
    for (let sync = 0; sync < 3; sync++) store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    // …also across the day beginning: before it the adapter still delivers a held put-back as "today" (`RemindersSource.withPlanning`,
    // its own test), so the day starting is no change of the source's answer
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
  })

  it('a planned card whose date moved away in Reminders stays on the board; Task.reminders updates', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', '2026-12-01')], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', null)], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a'])
    expect(store.task('a')!.reminders?.due).toBeNull()
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
  })

  it('a recurring task planned on another day stays planned, nothing written', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a@2026-11-25', '2026-11-25', { recurrence: 'FREQ=WEEKLY' })], BY_DATE)
    expect(store.planTask('a@2026-11-25')).toBe(true)
    for (let sync = 0; sync < 3; sync++) store.mergeTasks('reminders', [delivered('a@2026-11-25', '2026-11-25', { recurrence: 'FREQ=WEEKLY' })], BY_DATE)
    expect(isNotPlanned(store.task('a@2026-11-25')!)).toBe(false)
    expect(store.task('a@2026-11-25')!.pendingSync).toBeUndefined()
  })

  it('a planned card follows a title changed in Reminders and stays', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', TODAY, { title: 'Renamed in Reminders' })], BY_DATE)
    expect(store.task('a')).toMatchObject({ title: 'Renamed in Reminders' })
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a'])
  })

  it('a card in Jetzt or Wartet keeps its status when its date changes', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY), delivered('b', TODAY)], BY_DATE)
    store.updateTask('a', { status: TaskStatus.Progress })
    store.updateTask('b', { status: TaskStatus.Waiting })
    store.mergeTasks('reminders', [delivered('a', '2026-12-01'), delivered('b', null)], BY_DATE)
    expect(store.task('a')!.status).toBe(TaskStatus.Progress)
    expect(store.task('b')!.status).toBe(TaskStatus.Waiting)
    expect(isNotPlanned(store.task('a')!)).toBe(false)
  })

  it('a task with pendingSync keeps its local state, whatever the fetch says', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', '2026-11-25')], BY_DATE)
    store.planTask('a')
    store.markDateWrite('a', TODAY)
    store.mergeTasks('reminders', [delivered('a', '2026-11-25')], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', '2026-11-30')], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.reminders?.due?.date).toBe('2026-11-25')
    expect(store.task('a')!.pendingSync?.dateWrite).toBe(TODAY)
  })

  it('yesterday\'s board while the day has not begun: the cards stay, no write follows from a fetch', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY), delivered('b', TODAY)], BY_DATE)
    // The next morning the reminders are dated yesterday, the day has not begun
    store.mergeTasks('reminders', [delivered('a', '2026-11-19', { begun: false }), delivered('b', '2026-11-19', { begun: false })], BY_DATE)
    expect(store.tasksOpen.map(t => t.id).sort()).toEqual(['a', 'b'])
    expect(store.tasks.every(t => t.pendingSync === undefined)).toBe(true)
  })

  it('a card the fresh start put back and whose date is still yesterday joins again when the user dates it today', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
    store.unplanTask('a')
    store.mergeTasks('reminders', [delivered('a', '2026-11-19', { begun: false })], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    store.mergeTasks('reminders', [delivered('a', '2026-11-20')], BY_DATE)
    store.mergeTasks('reminders', [delivered('a', '2026-11-20')], BY_DATE)
    expect(isNotPlanned(store.task('a')!)).toBe(true)
  })

  it('without the option a source behaves as before: a planned card goes to "Alle Aufgaben" when the source says so', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [delivered('a', TODAY)], { holdsOnlyOpenDone: true, keepsKanDoFields: true })
    store.mergeTasks('reminders', [delivered('a', '2026-12-01')], { holdsOnlyOpenDone: true, keepsKanDoFields: true })
    expect(isNotPlanned(store.task('a')!)).toBe(true)
  })

  describe('Task.reminders.wrote', () => {
    const planned = (store: ReturnType<typeof useTasksStore>, from: string | null, at = Date.now()) => {
      store.mergeTasks('reminders', [delivered('a', from)], BY_DATE)
      store.planTask('a')
      store.updateTask('a', { reminders: { due: { date: TODAY, time: null }, recurrence: null, listId: 'L1', wrote: { from, to: TODAY, at } } })
    }

    it('survives a fetch that carries none, while Reminders still holds the date that was written', () => {
      const store = useTasksStore()
      planned(store, '2026-11-25')
      store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
      expect(store.task('a')!.reminders?.wrote).toMatchObject({ from: '2026-11-25', to: TODAY })
    })

    it('is dropped when Reminders holds another date than the one written', () => {
      const store = useTasksStore()
      planned(store, '2026-11-25')
      store.mergeTasks('reminders', [delivered('a', '2026-12-24')], BY_DATE)
      expect(store.task('a')!.reminders?.wrote).toBeUndefined()
      expect(isNotPlanned(store.task('a')!)).toBe(false)
    })

    it('is dropped once the day it was written on is over', () => {
      const store = useTasksStore()
      planned(store, '2026-11-25', new Date(2020, 0, 1).getTime())
      store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
      expect(store.task('a')!.reminders?.wrote).toBeUndefined()
    })

    it('a malformed stored value reads as none and is not carried', () => {
      const store = useTasksStore()
      planned(store, '2026-11-25')
      store.updateTask('a', { reminders: { due: { date: TODAY, time: null }, recurrence: null, listId: 'L1', wrote: { from: 7, to: TODAY } as never } })
      store.mergeTasks('reminders', [delivered('a', TODAY)], BY_DATE)
      expect(store.task('a')!.reminders?.wrote).toBeUndefined()
    })
  })
})

describe('a list an older version stored as Aktivität (#575)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('the held card carried the list title as its activity; the next fetch makes it the topic and clears the activity', () => {
    const store = useTasksStore()
    store.mergeTasks('reminders', [{ ...delivered('a', TODAY), topic: null, activity: 'Arbeit' }], BY_DATE)
    expect(store.task('a')).toMatchObject({ topic: null, activity: 'Arbeit' })

    store.mergeTasks('reminders', [{ ...delivered('a', TODAY), topic: 'Arbeit', activity: null }], BY_DATE)

    expect(store.task('a')).toMatchObject({ topic: 'Arbeit', activity: null })
    expect(store.task('a')!.pendingSync).toBeUndefined()
    expect(store.tasks.map(t => t.id)).toEqual(['a'])
  })
})
