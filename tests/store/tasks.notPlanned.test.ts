/**
 * #353: a task can be held without being on today's board. `Task.notPlanned` is kan-do's own marker (absent =
 * planned, valid only while the status is Open): the columns, the column order and the carried-over count leave
 * such a task out, the two moves put it on and take it off, and a merge keeps the marker of a task it already holds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { isNotPlanned, plannedTasks } from '~/lib/taskPlanning'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import { TaskStatus } from '~/types/taskStatus'
import { mapHelpers } from '~/utils/mapHelpers'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const source = overrides.source ?? 'local'
  return {
    id, source, externalId: source === 'local' ? null : id, title: `Task ${id}`, status: TaskStatus.Open, activity: null,
    topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
    ...overrides,
  }
}

describe('isNotPlanned: the single reader of the marker (#353)', () => {
  it('is true only for the marker `true` on an Open task', () => {
    expect(isNotPlanned(makeTask('a', { notPlanned: true }))).toBe(true)
    expect(isNotPlanned(makeTask('a'))).toBe(false)
    for (const status of [TaskStatus.Progress, TaskStatus.Waiting, TaskStatus.Done]) {
      expect(isNotPlanned(makeTask('a', { notPlanned: true, status }))).toBe(false)
    }
  })

  it('reads any other stored value as planned', () => {
    for (const value of [false, null, 'true', 1, {}]) {
      expect(isNotPlanned({ status: TaskStatus.Open, notPlanned: value as unknown as true })).toBe(false)
    }
  })

  it('plannedTasks keeps the tasks on the board', () => {
    const tasks = [makeTask('a'), makeTask('b', { notPlanned: true }), makeTask('c', { status: TaskStatus.Done })]
    expect(plannedTasks(tasks).map(t => t.id)).toEqual(['a', 'c'])
  })
})

describe('tasks store: a task that is not planned for today (#353)', () => {
  let store: ReturnType<typeof useTasksStore>
  let board: ReturnType<typeof useBoardStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
    board = useBoardStore()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  const offenOrder = () => board.columnByTaskStatus(TaskStatus.Open)?.taskOrder ?? []
  const offen = () => store.tasksOpen.map(t => t.id)

  it('is in no column and not in Offen\'s stored order, but still held and found by id', () => {
    store.setTasks([makeTask('a'), makeTask('b', { notPlanned: true }), makeTask('c')])

    expect(offen()).toEqual(['a', 'c'])
    expect(offenOrder()).toEqual(['a', 'c'])
    expect([...store.tasksProgress, ...store.tasksWaiting, ...store.tasksDone]).toEqual([])
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['b'])
    expect(store.task('b')?.title).toBe('Task b')
    expect(store.tasks).toHaveLength(3)
  })

  it('a board without a marker reads exactly as before: every task planned, order untouched', () => {
    store.setTasks([makeTask('a'), makeTask('b'), makeTask('c', { status: TaskStatus.Waiting })])
    expect(offen()).toEqual(['a', 'b'])
    expect(store.tasksNotPlanned).toEqual([])
    expect(store.tasks.some(t => 'notPlanned' in t)).toBe(false)
  })

  describe('the two moves', () => {
    const rich = (): Task => makeTask('b', {
      source: 'notion', externalId: 'page-b', timeSpentSeconds: 1234, notes: 'call back', topic: 'Haus', priority: 3,
      timeBoxSeconds: 1800, updatedAt: new Date(2026, 10, 1),
    })

    it('"not today" takes an Offen task off the board and changes nothing else about it', () => {
      store.setTasks([makeTask('a'), rich(), makeTask('c')])
      const before = { ...store.task('b')! }

      expect(store.unplanTask('b')).toBe(true)

      expect(offen()).toEqual(['a', 'c'])
      expect(offenOrder()).toEqual(['a', 'c'])
      expect(store.task('b')).toEqual({ ...before, notPlanned: true })
      expect(store.task('b')?.pendingSync).toBeUndefined()
      expect(store.isSyncPending('b')).toBe(false)
    })

    it('planning puts it at the end of Offen, again with nothing else changed (A -> B -> A)', () => {
      store.setTasks([makeTask('a'), rich(), makeTask('c')])
      const before = { ...store.task('b')! }
      store.unplanTask('b')

      expect(store.planTask('b')).toBe(true)

      expect(offen()).toEqual(['a', 'c', 'b'])
      expect(offenOrder()).toEqual(['a', 'c', 'b'])
      expect(store.task('b')).toEqual(before)
      expect('notPlanned' in store.task('b')!).toBe(false)

      store.unplanTask('a')
      store.planTask('a')
      expect(offen()).toEqual(['c', 'b', 'a'])
    })

    it('"not today" is refused outside Offen, for an unknown id and for a task that is already off', () => {
      store.setTasks([
        makeTask('p', { status: TaskStatus.Progress }), makeTask('w', { status: TaskStatus.Waiting }),
        makeTask('d', { status: TaskStatus.Done }), makeTask('o', { notPlanned: true }),
      ])
      for (const id of ['p', 'w', 'd', 'o', 'missing']) expect(store.unplanTask(id)).toBe(false)
      expect(store.tasks.filter(t => t.notPlanned).map(t => t.id)).toEqual(['o'])
      expect(store.tasksProgress.map(t => t.id)).toEqual(['p'])
    })

    it('planning a task that is already planned (or unknown) is a no-op', () => {
      store.setTasks([makeTask('a'), makeTask('b')])
      expect(store.planTask('a')).toBe(false)
      expect(store.planTask('missing')).toBe(false)
      expect(offenOrder()).toEqual(['a', 'b'])
    })

    it('a not-planned task does not count for the Jetzt limit and can still be moved into a column by status', () => {
      store.setTasks([makeTask('a', { notPlanned: true })])
      expect(store.tasksProgress).toHaveLength(0)
      store.updateTask('a', { status: TaskStatus.Progress })
      expect(store.tasksProgress.map(t => t.id)).toEqual(['a'])
      expect('notPlanned' in store.task('a')!).toBe(false)
    })
  })

  describe('the marker cannot outlive Open', () => {
    it('a status change away from Open drops it, and the way back does not bring it back', () => {
      store.setTasks([makeTask('a', { notPlanned: true })])
      store.updateTask('a', { status: TaskStatus.Done })
      expect('notPlanned' in store.task('a')!).toBe(false)
      store.updateTask('a', { status: TaskStatus.Open })
      expect(offen()).toEqual(['a'])
    })

    it('an edit that keeps the task Open keeps it (a title change, a write echo with the same status)', () => {
      store.setTasks([makeTask('a', { notPlanned: true })])
      store.updateTask('a', { title: 'renamed' })
      store.updateTask('a', { status: TaskStatus.Open, title: 'echo' })
      expect(store.task('a')?.notPlanned).toBe(true)
      expect(offen()).toEqual([])
    })

    it('a stale marker on a task an older app moved on never hides it when it comes back to Open', () => {
      store.setTasks([makeTask('a', { notPlanned: true, status: TaskStatus.Done })])
      expect(store.tasksDone.map(t => t.id)).toEqual(['a'])
      store.updateTask('a', { status: TaskStatus.Open })
      expect(offen()).toEqual(['a'])
      expect('notPlanned' in store.task('a')!).toBe(false)
    })

    it('the batch status update follows the same rule', () => {
      vi.useFakeTimers()
      store.setTasks([makeTask('a', { notPlanned: true }), makeTask('b', { notPlanned: true, status: TaskStatus.Done })])
      store.batchUpdateTaskStatus(['a'], TaskStatus.Waiting)
      store.batchUpdateTaskStatus(['b'], TaskStatus.Open)
      expect(store.tasks.some(t => 'notPlanned' in t)).toBe(false)
      vi.runAllTimers()
      vi.useRealTimers()
    })
  })

  describe.each(['notion', 'todoist'] as const)('mergeTasks keeps kan-do\'s marker (%s)', (source: SourceId) => {
    const held = (overrides: Partial<Task> = {}) => makeTask('x', { source, externalId: 'ext-x', timeSpentSeconds: 600, ...overrides })
    const fetched = (overrides: Partial<Task> = {}) => makeTask('ext-x', { source, externalId: 'ext-x', ...overrides })

    it('a fetched task that matches a held not-planned one stays not planned, sync after sync', () => {
      store.setTasks([makeTask('l'), held({ notPlanned: true })])

      store.mergeTasks(source, [fetched({ title: 'renamed upstream' })])
      store.mergeTasks(source, [fetched({ title: 'renamed upstream' })])

      const merged = store.task('x')!
      expect(merged.notPlanned).toBe(true)
      expect(merged.title).toBe('renamed upstream')
      expect(merged.timeSpentSeconds).toBe(600)
      expect(offen()).toEqual(['l'])
      expect(offenOrder()).toEqual(['l'])
    })

    it('keeps it for a task with unpushed changes too', () => {
      store.setTasks([held({ notPlanned: true, pendingSync: { since: 1, attempts: 0, lastError: null } })])
      store.mergeTasks(source, [fetched()])
      expect(store.task('x')?.notPlanned).toBe(true)
    })

    it('drops it when the source moved the task on: the task is on the board in its new column', () => {
      store.setTasks([held({ notPlanned: true })])
      store.mergeTasks(source, [fetched({ status: TaskStatus.Done })])
      expect('notPlanned' in store.task('x')!).toBe(false)
      expect(store.tasksDone.map(t => t.id)).toEqual(['x'])
    })

    it('a planned held task stays planned and a task new to kan-do arrives planned', () => {
      store.setTasks([held()])
      store.mergeTasks(source, [fetched(), makeTask('ext-new', { source, externalId: 'ext-new' })])
      expect(store.tasksNotPlanned).toEqual([])
      expect(offen().sort()).toEqual(['ext-new', 'x'])
    })

    it('a planned held task does not take a marker from the fetched copy', () => {
      store.setTasks([held()])
      store.mergeTasks(source, [fetched({ notPlanned: true })])
      expect('notPlanned' in store.task('x')!).toBe(false)
    })

    it('a not-planned task its source no longer returns is removed like a planned one', () => {
      store.setTasks([makeTask('l', { notPlanned: true }), held({ notPlanned: true })])
      store.mergeTasks(source, [])
      expect(store.tasks.map(t => t.id)).toEqual(['l'])
      expect(store.task('l')?.notPlanned).toBe(true)
    })

    it('a stale marker on a held task that is not Open does not take a re-opened task off the board', () => {
      store.setTasks([held({ notPlanned: true, status: TaskStatus.Waiting })])
      store.mergeTasks(source, [fetched({ status: TaskStatus.Open })])
      expect(offen()).toEqual(['x'])
    })
  })

  it('mergeTasks(local) keeps a Local task\'s marker (the fetch is the store\'s own tasks)', () => {
    store.setTasks([makeTask('a'), makeTask('b', { notPlanned: true }), makeTask('n', { source: 'notion', notPlanned: true })])
    store.mergeTasks('local', store.tasks.filter(t => t.source === 'local'))
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['b', 'n'])
    expect(offen()).toEqual(['a'])
  })

  it('a completed source switch that adopts a Local not-planned task keeps the marker', () => {
    store.setTasks([makeTask('page-1', { notPlanned: true, timeSpentSeconds: 60 })])
    store.mergeTasks('notion', [makeTask('page-1', { source: 'notion', externalId: 'page-1' })], { replaceOthers: true })
    expect(store.task('page-1')).toMatchObject({ source: 'notion', notPlanned: true, timeSpentSeconds: 60 })
  })

  describe('carried-over count', () => {
    const daysOf = (id: string) => mapHelpers.get(store.carryOverByTaskId, id)?.days

    it('is kept while the task is not planned and continues on the next planned day; days off do not count', () => {
      store.setTasks([makeTask('a'), makeTask('b')])
      store.recordCarryOver('2026-11-02')
      store.recordCarryOver('2026-11-03')
      expect(daysOf('b')).toBe(1)

      store.unplanTask('b')
      store.recordCarryOver('2026-11-04')
      store.recordCarryOver('2026-11-05')
      expect(daysOf('b')).toBe(1)
      expect(mapHelpers.get(store.carryOverByTaskId, 'b')?.lastOn).toBe('2026-11-03')
      expect(daysOf('a')).toBe(3)

      store.planTask('b')
      store.recordCarryOver('2026-11-06')
      expect(daysOf('b')).toBe(2)
      expect(daysOf('a')).toBe(4)
    })

    it('taken off and planned again on the same day counts nothing twice', () => {
      store.setTasks([makeTask('b')])
      store.recordCarryOver('2026-11-02')
      store.recordCarryOver('2026-11-03')
      store.unplanTask('b')
      store.recordCarryOver('2026-11-03')
      store.planTask('b')
      store.recordCarryOver('2026-11-03')
      expect(daysOf('b')).toBe(1)
    })

    it('a task that was never on the board gets its first day when it is planned', () => {
      store.setTasks([makeTask('b', { notPlanned: true })])
      store.recordCarryOver('2026-11-02')
      expect(mapHelpers.has(store.carryOverByTaskId, 'b')).toBe(false)
      store.planTask('b')
      store.recordCarryOver('2026-11-05')
      expect(daysOf('b')).toBe(0)
    })

    it('survives a merge while not planned, and an existing counter is never reset', () => {
      store.setTasks([makeTask('x', { source: 'notion', externalId: 'x' })])
      store.setCarryOver({ x: { firstOn: '2026-10-20', days: 5, lastOn: '2026-11-01', keptAtDays: 4 } })
      store.unplanTask('x')
      store.mergeTasks('notion', [makeTask('x', { source: 'notion', externalId: 'x' })])
      store.recordCarryOver('2026-11-03')
      expect(mapHelpers.get(store.carryOverByTaskId, 'x')).toEqual({ firstOn: '2026-10-20', days: 5, lastOn: '2026-11-01', keptAtDays: 4 })
    })
  })
})
